import fs from "node:fs";

import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export type ExportTarget = THREE.Object3D | THREE.Mesh;

function gatherGeometries(object: THREE.Object3D): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  const mat = new THREE.Matrix4();

  object.updateWorldMatrix(true, true);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry) return;
    const geom = mesh.geometry.clone();
    mat.copy(mesh.matrixWorld);
    geom.applyMatrix4(mat);
    geometries.push(geom);
  });

  if (geometries.length === 0) throw new Error("No geometry to export");
  let merged = geometries.length === 1 ? geometries[0] : (mergeGeometries(geometries, false) ?? geometries[0]);
  merged = mergeVertices(merged, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

function normalizeBinary(result: unknown): Uint8Array {
  if (typeof result === "string") return new TextEncoder().encode(result);
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  const view = result as ArrayBufferView;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function exportSTLBytes(object: ExportTarget): Uint8Array {
  const exporter = new STLExporter();
  const stl = exporter.parse(object as any, { binary: true });
  return normalizeBinary(stl);
}

export function exportSTL(object: ExportTarget, path: string): void {
  fs.writeFileSync(path, exportSTLBytes(object));
}

export function exportOBJString(object: ExportTarget): string {
  const exporter = new OBJExporter();
  return exporter.parse(object as any);
}

export function exportOBJ(object: ExportTarget, path: string): void {
  fs.writeFileSync(path, exportOBJString(object));
}

export async function exportGLBBytes(object: ExportTarget): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      object as any,
      (result) => {
        if (result instanceof ArrayBuffer) return resolve(result);
        try {
          const json = JSON.stringify(result);
          resolve(new TextEncoder().encode(json).buffer);
        } catch (e) {
          reject(e);
        }
      },
      (err) => reject(err),
      { binary: true }
    );
  });
  return new Uint8Array(arrayBuffer);
}

export async function exportGLB(object: ExportTarget, path: string): Promise<void> {
  fs.writeFileSync(path, await exportGLBBytes(object));
}

export type BlockbenchOptions = {
  voxelSize?: number;
  maxCubes?: number;
  name?: string;
};

export function exportBlockbenchBytes(object: ExportTarget, opts: BlockbenchOptions = {}): Uint8Array {
  const voxelSize = opts.voxelSize ?? 1.0;
  const maxCubes = opts.maxCubes ?? 5000;
  const name = opts.name ?? "model";

  const geom = gatherGeometries(object as THREE.Object3D);
  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  if (!bbox) throw new Error("Missing bounding box");

  const pos = geom.getAttribute("position");
  const seen = new Set<string>();
  const cubes: any[] = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const gx = Math.floor((x - bbox.min.x) / voxelSize);
    const gy = Math.floor((y - bbox.min.y) / voxelSize);
    const gz = Math.floor((z - bbox.min.z) / voxelSize);

    const key = `${gx},${gy},${gz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (cubes.length >= maxCubes) break;

    const cx = bbox.min.x + gx * voxelSize;
    const cy = bbox.min.y + gy * voxelSize;
    const cz = bbox.min.z + gz * voxelSize;

    cubes.push({
      name: `cube_${cubes.length}`,
      from: [cx, cy, cz],
      to: [cx + voxelSize, cy + voxelSize, cz + voxelSize],
      faces: {
        north: { uv: [0, 0, 16, 16], texture: 0 },
        south: { uv: [0, 0, 16, 16], texture: 0 },
        east: { uv: [0, 0, 16, 16], texture: 0 },
        west: { uv: [0, 0, 16, 16], texture: 0 },
        up: { uv: [0, 0, 16, 16], texture: 0 },
        down: { uv: [0, 0, 16, 16], texture: 0 },
      },
    });
  }

  const model = {
    format_version: "4.0",
    name,
    geometry_name: name,
    resolution: [16, 16, 16],
    elements: cubes,
    textures: [{ id: 0, name: "texture", width: 16, height: 16 }],
  };

  return new TextEncoder().encode(JSON.stringify(model, null, 2));
}

export function exportBlockbench(object: ExportTarget, path: string, opts: BlockbenchOptions = {}): void {
  fs.writeFileSync(path, exportBlockbenchBytes(object, opts));
}
