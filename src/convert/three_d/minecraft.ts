import fs from "node:fs";

import * as THREE from "three";
import * as voxelizer from "voxelizer";
import * as NBT from "nbtify";
import { gzipSync } from "fflate";

// Compatibility: some voxelizer versions still expect legacy THREE.Geometry APIs.
// Modern Three.js uses BufferGeometry and removed computeFaceNormals; alias it.
(() => {
  const proto = (THREE.BufferGeometry as any)?.prototype;
  if (!proto) return;
  if (typeof proto.computeFaceNormals !== "function") {
    proto.computeFaceNormals = function computeFaceNormalsCompat() {
      return this.computeVertexNormals();
    };
  }
})();

const { Sampler, ArrayExporter } = voxelizer as any;

export type VoxelVolume = {
  size: { x: number; y: number; z: number };
  /** 3D array: [x][y][z] => boolean filled */
  filled: boolean[][][];
};

type Rgb = { r: number; g: number; b: number };

type ColoredVoxelVolume = VoxelVolume & {
  /** Same shape as filled; null means "unknown" */
  color: (Rgb | null)[][][];
};

export type VoxelizeOptions = {
  /** World-units per voxel edge. */
  voxelSize?: number;
  /** If set, overrides computed resolution (higher -> more voxels). */
  resolution?: number;
  /** If true, tries to fill solid volume instead of surface. Default true. */
  fill?: boolean;
};

function objectToResolution(object: THREE.Object3D, voxelSize: number): number {
  const bbox = new THREE.Box3().setFromObject(object);
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return Math.max(1, Math.ceil(maxDim / voxelSize));
}

export async function voxelize(object: THREE.Object3D, options: VoxelizeOptions = {}): Promise<VoxelVolume> {
  const voxelSize = options.voxelSize ?? 1.0;
  const resolution = options.resolution ?? objectToResolution(object, voxelSize);
  const fill = options.fill ?? true;

  const sampler = new Sampler("raycast", { fill, color: false });
  const volume = sampler.sample(object, resolution);

  const [voxelArray] = await new Promise<any[]>((resolve) => {
    const exporter = new ArrayExporter();
    exporter.parse(volume, resolve);
  });

  const sx = voxelArray.length;
  const sy = voxelArray[0]?.length ?? 0;
  const sz = voxelArray[0]?.[0]?.length ?? 0;

  const filled: boolean[][][] = Array.from({ length: sx }, () =>
    Array.from({ length: sy }, () => Array.from({ length: sz }, () => false))
  );

  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        filled[x][y][z] = Boolean(voxelArray[x][y][z]);
      }
    }
  }

  return { size: { x: sx, y: sy, z: sz }, filled };
}

async function voxelizeSurfaceColors(object: THREE.Object3D, resolution: number): Promise<{
  size: { x: number; y: number; z: number };
  surface: boolean[][][];
  color: (Rgb | null)[][][];
}> {
  // voxelizer constraint: only one of {fill, color} can be true.
  const sampler = new Sampler("raycast", { fill: false, color: true });
  const volume = sampler.sample(object, resolution);

  const [surfaceArray, colorArray] = await new Promise<any[]>((resolve) => {
    const exporter = new ArrayExporter();
    exporter.parse(volume, resolve);
  });

  const sx = surfaceArray.length;
  const sy = surfaceArray[0]?.length ?? 0;
  const sz = surfaceArray[0]?.[0]?.length ?? 0;

  const surface: boolean[][][] = Array.from({ length: sx }, () =>
    Array.from({ length: sy }, () => Array.from({ length: sz }, () => false))
  );
  const color: (Rgb | null)[][][] = Array.from({ length: sx }, () =>
    Array.from({ length: sy }, () => Array.from({ length: sz }, () => null))
  );

  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        const occupied = Boolean(surfaceArray[x][y][z]);
        surface[x][y][z] = occupied;
        if (!occupied) continue;

        const r = colorArray?.[x]?.[y]?.[z]?.[0];
        const g = colorArray?.[x]?.[y]?.[z]?.[1];
        const b = colorArray?.[x]?.[y]?.[z]?.[2];
        if (typeof r === "number" && typeof g === "number" && typeof b === "number") {
          color[x][y][z] = { r, g, b };
        }
      }
    }
  }

  return { size: { x: sx, y: sy, z: sz }, surface, color };
}

async function voxelizeWithColors(object: THREE.Object3D, options: VoxelizeOptions = {}): Promise<ColoredVoxelVolume> {
  const voxelSize = options.voxelSize ?? 1.0;
  const resolution = options.resolution ?? objectToResolution(object, voxelSize);

  const filled = await voxelize(object, { voxelSize, resolution, fill: true });
  const surface = await voxelizeSurfaceColors(object, resolution);

  // If dimensions disagree, fall back to no colors (shouldn't happen if resolution matches).
  if (
    filled.size.x !== surface.size.x ||
    filled.size.y !== surface.size.y ||
    filled.size.z !== surface.size.z
  ) {
    const emptyColor: (Rgb | null)[][][] = Array.from({ length: filled.size.x }, () =>
      Array.from({ length: filled.size.y }, () => Array.from({ length: filled.size.z }, () => null))
    );
    return { ...filled, color: emptyColor };
  }

  const color: (Rgb | null)[][][] = Array.from({ length: filled.size.x }, () =>
    Array.from({ length: filled.size.y }, () => Array.from({ length: filled.size.z }, () => null))
  );

  for (let x = 0; x < filled.size.x; x++) {
    for (let y = 0; y < filled.size.y; y++) {
      for (let z = 0; z < filled.size.z; z++) {
        if (!filled.filled[x][y][z]) continue;
        // Use surface color at same voxel if available; interiors remain null.
        color[x][y][z] = surface.color[x][y][z];
      }
    }
  }

  return { ...filled, color };
}

function encodeVarInt(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  while ((v & 0xffffff80) !== 0) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

export type SchemExportOptions = {
  voxelSize?: number;
  /** Used for paletteMode: "single". */
  blockName?: string;
  /** If set, uses a color→block palette (default: "single"). */
  paletteMode?: "single" | "wool16" | "rules";
  /** Used for paletteMode: "rules" when no rule matches. */
  defaultBlock?: BlockState;
  /** Optional rule-based assignment. First match wins. */
  rules?: BlockRule[];
  /**
   * Optional palette preload:
   * - If provided, all blocks/states are added to the palette before writing BlockData.
   * - This is NOT required for a valid .schem (palette can be minimal), but supported if you want a full palette.
   */
  preloadPalettePath?: string;
  preloadPalette?: Array<{ name: string; states: Array<Record<string, string>> }>;
  /** If true, run an extra pass to sample surface colors for ctx.color. */
  enableColorSampling?: boolean;
  dataVersion?: number;
  /** If true, gzip the NBT (recommended for .schem). */
  gzip?: boolean;
};

export type BlockState = {
  name: string;
  states?: Record<string, string>;
};

export type BlockRuleContext = {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  length: number;
  color: Rgb | null;
};

export type BlockRule = {
  state: BlockState;
  condition?: (ctx: BlockRuleContext) => boolean;
};

function toBlockStateKey(state: BlockState): string {
  const base = state.name;
  const props = state.states ? Object.entries(state.states) : [];
  if (props.length === 0) return base;
  props.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${base}[${props.map(([k, v]) => `${k}=${v}`).join(",")}]`;
}

class PaletteBuilder {
  private map = new Map<string, number>();

  constructor() {
    this.getOrAdd({ name: "minecraft:air" });
  }

  getOrAdd(state: BlockState): number {
    const key = toBlockStateKey(state);
    const existing = this.map.get(key);
    if (existing !== undefined) return existing;
    const id = this.map.size; // air is 0
    this.map.set(key, id);
    return id;
  }

  toNbtPalette(): { palette: Record<string, NBT.Tag>; paletteMax: number } {
    const palette: Record<string, NBT.Tag> = {};
    for (const [key, id] of this.map.entries()) {
      palette[key] = new NBT.Int32(id);
    }
    return { palette, paletteMax: this.map.size };
  }
}

function preloadPalette(
  paletteBuilder: PaletteBuilder,
  spec: Array<{ name: string; states: Array<Record<string, string>> }>
) {
  for (const entry of spec) {
    const name = entry.name;
    const states = entry.states ?? [];
    if (states.length === 0) {
      paletteBuilder.getOrAdd({ name });
      continue;
    }
    for (const s of states) {
      paletteBuilder.getOrAdd({ name, states: s });
    }
  }
}

const WOOL16: Array<{ block: string; rgb: Rgb }> = [
  { block: "minecraft:white_wool", rgb: { r: 234, g: 236, b: 237 } },
  { block: "minecraft:orange_wool", rgb: { r: 240, g: 118, b: 19 } },
  { block: "minecraft:magenta_wool", rgb: { r: 189, g: 68, b: 179 } },
  { block: "minecraft:light_blue_wool", rgb: { r: 58, g: 175, b: 217 } },
  { block: "minecraft:yellow_wool", rgb: { r: 248, g: 198, b: 39 } },
  { block: "minecraft:lime_wool", rgb: { r: 112, g: 185, b: 25 } },
  { block: "minecraft:pink_wool", rgb: { r: 237, g: 141, b: 172 } },
  { block: "minecraft:gray_wool", rgb: { r: 62, g: 68, b: 71 } },
  { block: "minecraft:light_gray_wool", rgb: { r: 142, g: 142, b: 134 } },
  { block: "minecraft:cyan_wool", rgb: { r: 21, g: 137, b: 145 } },
  { block: "minecraft:purple_wool", rgb: { r: 121, g: 42, b: 172 } },
  { block: "minecraft:blue_wool", rgb: { r: 53, g: 57, b: 157 } },
  { block: "minecraft:brown_wool", rgb: { r: 114, g: 71, b: 40 } },
  { block: "minecraft:green_wool", rgb: { r: 84, g: 109, b: 27 } },
  { block: "minecraft:red_wool", rgb: { r: 161, g: 39, b: 34 } },
  { block: "minecraft:black_wool", rgb: { r: 20, g: 21, b: 25 } },
];

function dist2(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function pickNearestWool(rgb: Rgb): { block: string; id: number } {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < WOOL16.length; i++) {
    const d = dist2(rgb, WOOL16[i].rgb);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // id 0 is air, wools are 1..16
  return { block: WOOL16[best].block, id: best + 1 };
}

export async function exportMinecraftSchemBytes(object: THREE.Object3D, opts: SchemExportOptions = {}): Promise<Uint8Array> {
  const voxelSize = opts.voxelSize ?? 1.0;
  const blockName = opts.blockName ?? "minecraft:stone";
  const paletteMode = opts.paletteMode ?? "single";
  const enableColorSampling = opts.enableColorSampling ?? false;
  const dataVersion = opts.dataVersion ?? 3700;
  const gzip = opts.gzip ?? true;

  const vol = (paletteMode === "wool16" || (paletteMode === "rules" && enableColorSampling))
    ? await voxelizeWithColors(object, { voxelSize, fill: true })
    : ({ ...(await voxelize(object, { voxelSize, fill: true })), color: [] as any } as ColoredVoxelVolume);

  const width = vol.size.x;
  const height = vol.size.y;
  const length = vol.size.z;

  const paletteBuilder = new PaletteBuilder();

  // Optional preload (e.g. generated vanillaBlocks.json). This can be huge.
  const preloadSpec = opts.preloadPalette ?? (opts.preloadPalettePath ? (JSON.parse(fs.readFileSync(opts.preloadPalettePath, "utf8")) as any) : null);
  if (Array.isArray(preloadSpec)) {
    preloadPalette(paletteBuilder, preloadSpec);
  }

  let paletteMax = 0;
  let palette: Record<string, NBT.Tag> = {};

  if (paletteMode === "wool16") {
    for (let i = 0; i < WOOL16.length; i++) {
      paletteBuilder.getOrAdd({ name: WOOL16[i].block });
    }
    ({ palette, paletteMax } = paletteBuilder.toNbtPalette());
  } else if (paletteMode === "rules") {
    const defaultBlock = opts.defaultBlock ?? { name: blockName };
    paletteBuilder.getOrAdd(defaultBlock);
    for (const rule of opts.rules ?? []) {
      paletteBuilder.getOrAdd(rule.state);
    }
    ({ palette, paletteMax } = paletteBuilder.toNbtPalette());
  } else {
    paletteBuilder.getOrAdd({ name: blockName });
    ({ palette, paletteMax } = paletteBuilder.toNbtPalette());
  }

  const varIntBlockData: number[] = [];
  // Block order for Sponge schem is y, z, x in many implementations.
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        if (!vol.filled[x][y][z]) {
          varIntBlockData.push(...encodeVarInt(0));
          continue;
        }

        if (paletteMode === "wool16") {
          const c = vol.color?.[x]?.[y]?.[z];
          const id = c ? pickNearestWool(c).id : 1; // fallback to white wool
          varIntBlockData.push(...encodeVarInt(id));
        } else if (paletteMode === "rules") {
          const ctx: BlockRuleContext = {
            x,
            y,
            z,
            width,
            height,
            length,
            color: vol.color?.[x]?.[y]?.[z] ?? null,
          };

          let chosen: BlockState = opts.defaultBlock ?? { name: blockName };
          for (const rule of opts.rules ?? []) {
            if (!rule.condition || rule.condition(ctx)) {
              chosen = rule.state;
              break;
            }
          }

          const id = paletteBuilder.getOrAdd(chosen);
          varIntBlockData.push(...encodeVarInt(id));
        } else {
          // single block mode uses paletteBuilder IDs
          const id = paletteBuilder.getOrAdd({ name: blockName });
          varIntBlockData.push(...encodeVarInt(id));
        }
      }
    }
  }

  const nbt = new NBT.NBTData(
    {
      Version: new NBT.Int32(2),
      DataVersion: new NBT.Int32(dataVersion),
      Width: new NBT.Int16(width),
      Height: new NBT.Int16(height),
      Length: new NBT.Int16(length),
      PaletteMax: new NBT.Int32(paletteMax),
      Palette: palette,
      BlockData: new Int8Array(varIntBlockData),
      BlockEntities: [],
      Entities: [],
    },
    { rootName: "Schematic" }
  );

  let bytes = await NBT.write(nbt);
  if (gzip) bytes = gzipSync(bytes);
  return bytes;
}

export async function exportMinecraftSchem(object: THREE.Object3D, path: string, opts: SchemExportOptions = {}): Promise<void> {
  fs.writeFileSync(path, await exportMinecraftSchemBytes(object, opts));
}
