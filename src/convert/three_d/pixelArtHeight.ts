import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export type PixelArtHeightOptions = {
  /** Size of one pixel in world units (default: 1.0). */
  pixelSize?: number;
  /** Multiplier applied to computed height (default: 1.0). */
  heightScale?: number;
  /** Clamp to avoid near-zero geometry (default: 0.02). */
  minHeight?: number;
  /** Upper bound to avoid generating absurd geometry. */
  maxSolidPixels?: number;
  /** If true, pixels with alpha==0 are ignored (default: true). */
  ignoreTransparent?: boolean;
};

function rgbaKey(r: number, g: number, b: number, a: number): string {
  return `${r},${g},${b},${a}`;
}

/**
 * Re-implements 3DPixelArtGenerator's core idea:
 * - Build a unique color list in scan order.
 * - For each non-transparent pixel, create a 1x1xH prism where H depends on the color rank.
 */
export function pixelArtHeightMeshFromRgba(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  opts: PixelArtHeightOptions = {}
): THREE.Mesh {
  const pixelSize = opts.pixelSize ?? 1.0;
  const heightScale = opts.heightScale ?? 1.0;
  const minHeight = opts.minHeight ?? 0.02;
  const maxSolidPixels = opts.maxSolidPixels ?? 250_000;
  const ignoreTransparent = opts.ignoreTransparent ?? true;

  if (width <= 0 || height <= 0) throw new Error("Invalid image size");
  if (rgba.length !== width * height * 4) throw new Error("Invalid RGBA buffer length");

  const data = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);

  // Build unique color list (scan order), excluding transparent pixels.
  const colorToIndex = new Map<string, number>();
  const colors: string[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (ignoreTransparent && a === 0) continue;
      const key = rgbaKey(r, g, b, a);
      if (!colorToIndex.has(key)) {
        colorToIndex.set(key, colors.length);
        colors.push(key);
      }
    }
  }

  if (colors.length === 0) throw new Error("No non-transparent pixels found.");

  const geometries: THREE.BufferGeometry[] = [];

  let solidCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (ignoreTransparent && a === 0) continue;

      solidCount++;
      if (solidCount > maxSolidPixels) throw new Error("Too many pixels; downscale the image.");

      const key = rgbaKey(r, g, b, a);
      const colorIndex = colorToIndex.get(key);
      if (colorIndex === undefined) continue;

      // Original python: height = 1 - idx/len
      const rawHeight = 1 - colorIndex / colors.length;
      const h = Math.max(minHeight, rawHeight * heightScale);

      const geom = new THREE.BoxGeometry(pixelSize, pixelSize, h);
      // Place origin at image center, +Y up, +Z up.
      geom.translate((x - width / 2) * pixelSize, (height / 2 - y) * pixelSize, h / 2);
      geometries.push(geom);
    }
  }

  if (geometries.length === 0) throw new Error("No pixels produced geometry.");

  let merged = geometries.length === 1 ? geometries[0] : (mergeGeometries(geometries, false) ?? geometries[0]);
  merged = mergeVertices(merged, 1e-6);
  merged.computeVertexNormals();

  return new THREE.Mesh(merged, new THREE.MeshStandardMaterial());
}
