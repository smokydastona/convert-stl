import fs from "node:fs";

import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

export type LoadedMesh = {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
};

export function loadSTLBytes(bytes: Uint8Array, material?: THREE.Material): LoadedMesh {
  const loader = new STLLoader();
  // Ensure we pass an ArrayBuffer (not a possibly-SharedArrayBuffer view).
  const copy = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const arrayBuffer = new ArrayBuffer(copy.byteLength);
  new Uint8Array(arrayBuffer).set(copy);
  const geometry = loader.parse(arrayBuffer);
  const mesh = new THREE.Mesh(geometry, material ?? new THREE.MeshStandardMaterial());
  return { geometry, mesh };
}

export function loadSTL(path: string, material?: THREE.Material): LoadedMesh {
  const bytes = fs.readFileSync(path);
  return loadSTLBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), material);
}
