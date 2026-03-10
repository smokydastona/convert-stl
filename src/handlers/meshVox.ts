import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

import { voxelize } from "src/convert/three_d/minecraft.ts";

const TARGET_RESOLUTION = 64;

function computeVoxelSizeForResolution(object: THREE.Object3D, targetResolution: number): number {
  const bbox = new THREE.Box3().setFromObject(object);
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return 1.0;
  return maxDim / Math.max(1, targetResolution);
}

function getObjectBBox(object: THREE.Object3D) {
  const bbox = new THREE.Box3().setFromObject(object);
  const min = bbox.min;
  const max = bbox.max;
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
  };
}

async function loadObjectFromBytes(bytes: Uint8Array, inputFormat: FileFormat): Promise<THREE.Object3D> {
  const blob = new Blob([bytes as BlobPart]);
  const url = URL.createObjectURL(blob);
  try {
    switch (inputFormat.internal) {
      case "glb": {
        const gltf: GLTF = await new Promise((resolve, reject) => {
          const loader = new GLTFLoader();
          loader.load(url, resolve, undefined, reject);
        });
        return gltf.scene;
      }
      case "obj": {
        return await new Promise((resolve, reject) => {
          const loader = new OBJLoader();
          loader.load(url, resolve, undefined, reject);
        });
      }
      case "stl": {
        const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
          const loader = new STLLoader();
          loader.load(url, resolve, undefined, reject);
        });
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial());
        const group = new THREE.Group();
        group.add(mesh);
        return group;
      }
      case "ply": {
        const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
          const loader = new PLYLoader();
          loader.load(url, resolve, undefined, reject);
        });
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial());
        const group = new THREE.Group();
        group.add(mesh);
        return group;
      }
      default:
        throw new Error(`Unsupported input for meshVox: ${inputFormat.internal}`);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

type SparseVoxelGridJson = {
  size: { x: number; y: number; z: number };
  bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  voxels: Array<[number, number, number]>;
};

class meshVoxHandler implements FormatHandler {
  public name: string = "meshVox";

  public supportedFormats: FileFormat[] = [
    {
      name: "GL Transmission Format Binary",
      format: "glb",
      extension: "glb",
      mime: "model/gltf-binary",
      from: true,
      to: false,
      internal: "glb",
      category: "model",
    },
    {
      name: "GL Transmission Format",
      format: "gltf",
      extension: "gltf",
      mime: "model/gltf+json",
      from: true,
      to: false,
      internal: "glb",
      category: "model",
    },
    {
      name: "Wavefront OBJ",
      format: "obj",
      extension: "obj",
      mime: "model/obj",
      from: true,
      to: false,
      internal: "obj",
      category: "model",
    },
    {
      name: "Stereolithography",
      format: "stl",
      extension: "stl",
      mime: "model/stl",
      from: true,
      to: false,
      internal: "stl",
      category: "model",
    },
    {
      name: "Polygon File Format",
      format: "ply",
      extension: "ply",
      mime: "model/ply",
      from: true,
      to: false,
      internal: "ply",
      category: "model",
    },
    {
      name: "Voxel Grid JSON (Sparse)",
      format: "voxels",
      extension: "json",
      mime: "application/vnd.voxel+json",
      from: false,
      to: true,
      internal: "voxels",
      category: ["model", "voxel"],
    },
  ];

  public ready: boolean = false;

  async init() {
    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    if (outputFormat.internal !== "voxels") {
      throw new Error(`Unsupported output for meshVox: ${outputFormat.internal}`);
    }

    const out: FileData[] = [];

    for (const input of inputFiles) {
      const baseName = input.name.replace(/\.[^.]+$/, "");
      const object = await loadObjectFromBytes(input.bytes, inputFormat);

      // Choose voxel size so the longest dimension is ~TARGET_RESOLUTION voxels.
      const voxelSize = computeVoxelSizeForResolution(object, TARGET_RESOLUTION);
      const vol = await voxelize(object, { voxelSize, fill: true });
      const bbox = getObjectBBox(object);

      const voxels: Array<[number, number, number]> = [];
      for (let x = 0; x < vol.size.x; x++) {
        for (let y = 0; y < vol.size.y; y++) {
          for (let z = 0; z < vol.size.z; z++) {
            if (vol.filled[x][y][z]) voxels.push([x, y, z]);
          }
        }
      }

      const payload: SparseVoxelGridJson = { size: vol.size, bbox, voxels };
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      out.push({ name: `${baseName}.voxels.json`, bytes });
    }

    return out;
  }
}

export default meshVoxHandler;
