import fs from "node:fs";
import path from "node:path";

import * as THREE from "three";

import { loadSTL } from "../src/convert/three_d/stlImport.js";
import { cleanMesh } from "../src/convert/three_d/meshCleanup.js";
import { exportMinecraftSchem } from "../src/convert/three_d/minecraft.js";

type Args = {
  inFile: string;
  outFile: string;
  voxelSize: number;
  paletteMode: "single" | "wool16" | "rules";
  preloadPalettePath?: string;
  defaultBlock: string;
  gzip: boolean;
  colorSampling: boolean;
  center: boolean;
  zToFloor: boolean;
  normalizeOrientation: boolean;
};

function usage(): never {
  const msg = `Usage:
  npx tsx scripts/stl2schem.ts --in <input.stl> --out <output.schem> [options]

Options:
  --voxelSize <number>              World units per voxel (default: 1)
  --paletteMode <single|wool16|rules> (default: single)
  --preloadPalettePath <file.json>  Preload full palette from vanillaBlocks.json
  --defaultBlock <namespace:id>     Default block (default: minecraft:stone)
  --gzip <true|false>              Gzip output (default: true)
  --colorSampling <true|false>      Enable surface color sampling for rules (default: false)

Mesh cleanup:
  --center <true|false>             Center geometry (default: false)
  --zToFloor <true|false>           Move minZ to 0 (default: true)
  --normalizeOrientation <true|false> Best-effort rotate longest axis to X (default: false)
`;
  console.error(msg);
  process.exit(2);
}

function parseBool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return def;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    inFile: "",
    outFile: "",
    voxelSize: 1,
    paletteMode: "single",
    preloadPalettePath: undefined,
    defaultBlock: "minecraft:stone",
    gzip: true,
    colorSampling: false,
    center: false,
    zToFloor: true,
    normalizeOrientation: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") out.inFile = argv[++i] ?? "";
    else if (a === "--out") out.outFile = argv[++i] ?? "";
    else if (a === "--voxelSize") out.voxelSize = Number(argv[++i] ?? "1") || 1;
    else if (a === "--paletteMode") out.paletteMode = (argv[++i] as any) ?? "single";
    else if (a === "--preloadPalettePath") out.preloadPalettePath = argv[++i];
    else if (a === "--defaultBlock") out.defaultBlock = argv[++i] ?? out.defaultBlock;
    else if (a === "--gzip") out.gzip = parseBool(argv[++i], out.gzip);
    else if (a === "--colorSampling") out.colorSampling = parseBool(argv[++i], out.colorSampling);
    else if (a === "--center") out.center = parseBool(argv[++i], out.center);
    else if (a === "--zToFloor") out.zToFloor = parseBool(argv[++i], out.zToFloor);
    else if (a === "--normalizeOrientation") out.normalizeOrientation = parseBool(argv[++i], out.normalizeOrientation);
  }

  if (!out.inFile || !out.outFile) usage();
  if (!fs.existsSync(out.inFile)) {
    throw new Error(`Input file not found: ${out.inFile}`);
  }

  if (!out.outFile.endsWith(".schem") && !out.outFile.endsWith(".schematic")) {
    // Not fatal, but avoids surprise.
    console.warn(`Warning: output does not end with .schem/.schematic: ${out.outFile}`);
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const loaded = loadSTL(args.inFile);
  const cleaned = cleanMesh(loaded.mesh, {
    center: args.center,
    zToFloor: args.zToFloor,
    normalizeOrientation: args.normalizeOrientation,
  });

  const outPath = path.resolve(args.outFile);
  await exportMinecraftSchem(cleaned, outPath, {
    voxelSize: args.voxelSize,
    paletteMode: args.paletteMode,
    preloadPalettePath: args.preloadPalettePath,
    defaultBlock: { name: args.defaultBlock },
    enableColorSampling: args.colorSampling,
    gzip: args.gzip,
  });

  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
