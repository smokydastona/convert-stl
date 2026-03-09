import fs from "node:fs";

import * as THREE from "three";
import { PNG } from "pngjs";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export type ImageToMeshOptions = {
  /** Extrusion thickness in world units (default: 2.0). */
  thickness?: number;
  /** Size of one pixel in world units (default: 1.0). */
  pixelSize?: number;
  /** Threshold 0..255 (default: 128). */
  threshold?: number;
  /** If true, treat white as solid. If false, treat black as solid. Default: auto. */
  whiteIsSolid?: boolean;
  /** Upper bound to avoid creating absurd geometry. */
  maxSolidPixels?: number;
};

function decideWhiteIsSolid(mask: Uint8Array): boolean {
  let on = 0;
  for (let i = 0; i < mask.length; i++) on += mask[i] ? 1 : 0;
  // If most pixels are on, assume background is white and invert.
  return on >= mask.length / 2;
}

export function imageToVoxelMeshFromPngBytes(pngBytes: Uint8Array, opts: ImageToMeshOptions = {}): THREE.Mesh {
  const thickness = opts.thickness ?? 2.0;
  const pixelSize = opts.pixelSize ?? 1.0;
  const threshold = opts.threshold ?? 128;
  const maxSolidPixels = opts.maxSolidPixels ?? 250_000;

  const png = PNG.sync.read(Buffer.from(pngBytes));
  const { width, height, data } = png;

  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const v = data[idx];
      mask[y * width + x] = v > threshold ? 1 : 0;
    }
  }

  const whiteIsSolid = opts.whiteIsSolid ?? decideWhiteIsSolid(mask);

  const geometries: THREE.BufferGeometry[] = [];
  const box = new THREE.BoxGeometry(pixelSize, pixelSize, thickness);

  let solidCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = mask[y * width + x] === 1;
      const solid = whiteIsSolid ? m : !m;
      if (!solid) continue;
      solidCount++;
      if (solidCount > maxSolidPixels) throw new Error("Too many solid pixels; increase threshold or downscale the image.");

      const geom = box.clone();
      // Place origin at image center, +Y up, +Z thickness.
      geom.translate(
        (x - width / 2) * pixelSize,
        (height / 2 - y) * pixelSize,
        thickness / 2
      );
      geometries.push(geom);
    }
  }

  if (geometries.length === 0) throw new Error("No solid pixels found.");

  let merged = geometries.length === 1 ? geometries[0] : (mergeGeometries(geometries, false) ?? geometries[0]);
  merged = mergeVertices(merged, 1e-6);
  merged.computeVertexNormals();

  return new THREE.Mesh(merged, new THREE.MeshStandardMaterial());
}

export function imageToVoxelMesh(path: string, opts: ImageToMeshOptions = {}): THREE.Mesh {
  const bytes = fs.readFileSync(path);
  return imageToVoxelMeshFromPngBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), opts);
}
