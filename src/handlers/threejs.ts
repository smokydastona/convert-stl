import CommonFormats from "src/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { PLYExporter } from "three/addons/exporters/PLYExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

type BlockbenchRotation = {
  origin?: [number, number, number];
  axis?: "x" | "y" | "z" | string;
  angle?: number;
};

type BlockbenchElement = {
  name?: string;
  from?: [number, number, number];
  to?: [number, number, number];
  rotation?: BlockbenchRotation;
};

type SparseVoxelGridJson = {
  size: { x: number; y: number; z: number };
  bbox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  voxels: Array<[number, number, number]>;
};

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Invalid JSON");
  }
}

function buildMeshForFromTo(from: [number, number, number], to: [number, number, number], rotation?: BlockbenchRotation): THREE.Mesh {
  const fx = from[0], fy = from[1], fz = from[2];
  const tx = to[0], ty = to[1], tz = to[2];
  const sx = Math.max(0.0001, tx - fx);
  const sy = Math.max(0.0001, ty - fy);
  const sz = Math.max(0.0001, tz - fz);
  const cx = (fx + tx) / 2;
  const cy = (fy + ty) / 2;
  const cz = (fz + tz) / 2;

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  mesh.scale.set(sx, sy, sz);

  const origin = new THREE.Vector3(
    rotation?.origin?.[0] ?? 0,
    rotation?.origin?.[1] ?? 0,
    rotation?.origin?.[2] ?? 0,
  );

  // Position relative to rotation origin, rotate, then translate back.
  mesh.position.set(cx - origin.x, cy - origin.y, cz - origin.z);
  const axis = (rotation?.axis ?? "") as string;
  const angle = THREE.MathUtils.degToRad(rotation?.angle ?? 0);
  if (angle !== 0) {
    if (axis === "x") mesh.rotateX(angle);
    else if (axis === "y") mesh.rotateY(angle);
    else if (axis === "z") mesh.rotateZ(angle);
  }
  mesh.position.add(origin);

  return mesh;
}

function importBlockbenchObject(json: any): THREE.Group {
  const group = new THREE.Group();

  // Common Blockbench/Minecraft Java block model export shape.
  const elements = (json?.elements ?? json?.cubes) as unknown;
  if (Array.isArray(elements)) {
    for (const el of elements as BlockbenchElement[]) {
      if (!el?.from || !el?.to) continue;
      const mesh = buildMeshForFromTo(el.from, el.to, el.rotation);
      mesh.name = el.name ?? "element";
      group.add(mesh);
    }
    if (group.children.length > 0) return group;
  }

  // Blockbench/Minecraft Bedrock geometry export shape (very minimal support).
  const geometries = (json?.["minecraft:geometry"] ?? json?.minecraft_geometry) as unknown;
  if (Array.isArray(geometries) && geometries.length > 0) {
    const geo0 = geometries[0];
    const bones = geo0?.bones;
    if (Array.isArray(bones)) {
      for (const bone of bones) {
        const cubes = bone?.cubes;
        if (!Array.isArray(cubes)) continue;
        for (const cube of cubes) {
          const origin = cube?.origin;
          const size = cube?.size;
          if (!Array.isArray(origin) || !Array.isArray(size) || origin.length < 3 || size.length < 3) continue;
          const from: [number, number, number] = [origin[0], origin[1], origin[2]];
          const to: [number, number, number] = [origin[0] + size[0], origin[1] + size[1], origin[2] + size[2]];
          const mesh = buildMeshForFromTo(from, to);
          mesh.name = cube?.name ?? bone?.name ?? "cube";
          group.add(mesh);
        }
      }
      if (group.children.length > 0) return group;
    }
  }

  throw new Error("Unsupported Blockbench JSON (no elements/cubes found)");
}

function importSparseVoxelGrid(json: any): THREE.Group {
  const data = json as SparseVoxelGridJson;
  if (!data || !data.size || !Array.isArray(data.voxels)) {
    throw new Error("Unsupported voxel JSON (missing size/voxels)");
  }

  const sizeX = Math.max(1, Number(data.size.x) || 1);
  const sizeY = Math.max(1, Number(data.size.y) || 1);
  const sizeZ = Math.max(1, Number(data.size.z) || 1);

  const bboxMin = data.bbox?.min ?? { x: 0, y: 0, z: 0 };
  const bboxMax = data.bbox?.max ?? { x: sizeX, y: sizeY, z: sizeZ };

  const voxelSizeX = (bboxMax.x - bboxMin.x) / sizeX;
  const voxelSizeY = (bboxMax.y - bboxMin.y) / sizeY;
  const voxelSizeZ = (bboxMax.z - bboxMin.z) / sizeZ;

  const geom = new THREE.BoxGeometry(
    Math.max(0.0001, voxelSizeX),
    Math.max(0.0001, voxelSizeY),
    Math.max(0.0001, voxelSizeZ),
  );
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });

  const group = new THREE.Group();
  for (const v of data.voxels) {
    if (!Array.isArray(v) || v.length < 3) continue;
    const [x, y, z] = v;
    const cx = bboxMin.x + (Number(x) + 0.5) * voxelSizeX;
    const cy = bboxMin.y + (Number(y) + 0.5) * voxelSizeY;
    const cz = bboxMin.z + (Number(z) + 0.5) * voxelSizeZ;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(cx, cy, cz);
    group.add(mesh);
  }

  if (group.children.length === 0) {
    throw new Error("Unsupported voxel JSON (no voxels)");
  }

  return group;
}

function exportBlockbenchFromObject(object: THREE.Object3D, voxelSize = 1.0, maxCubes = 5000): Uint8Array {
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
  merged.computeBoundingBox();
  const bbox = merged.boundingBox;
  if (!bbox) throw new Error("Missing bounding box");

  const pos = merged.getAttribute("position");
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
    name: "model",
    geometry_name: "model",
    resolution: [16, 16, 16],
    elements: cubes,
    textures: [{ id: 0, name: "texture", width: 16, height: 16 }],
  };

  return new TextEncoder().encode(JSON.stringify(model, null, 2));
}

class threejsHandler implements FormatHandler {

  public name: string = "threejs";
  public supportedFormats = [
    {
      name: "GL Transmission Format Binary",
      format: "glb",
      extension: "glb",
      mime: "model/gltf-binary",
      from: true,
      to: true,
      internal: "glb",
      category: "model"
    },
    {
      name: "GL Transmission Format",
      format: "gltf",
      extension: "gltf",
      mime: "model/gltf+json",
      from: true,
      to: true,
      internal: "glb",
      category: "model"
    },
    {
      name: "Waveform OBJ",
      format: "obj",
      extension: "obj",
      mime: "model/obj",
      from: true,
      to: true,
      internal: "obj",
      category: "model",
    },
    {
      name: "Stereolithography",
      format: "stl",
      extension: "stl",
      mime: "model/stl",
      from: true,
      to: true,
      internal: "stl",
      category: "model",
    },
    {
      name: "Polygon File Format",
      format: "ply",
      extension: "ply",
      mime: "model/ply",
      from: true,
      to: true,
      internal: "ply",
      category: "model",
    },
    {
      name: "COLLADA",
      format: "dae",
      extension: "dae",
      mime: "model/vnd.collada+xml",
      from: true,
      to: false,
      internal: "dae",
      category: "model",
    },
    {
      name: "Autodesk FBX",
      format: "fbx",
      extension: "fbx",
      mime: "model/fbx",
      from: true,
      to: false,
      internal: "fbx",
      category: "model",
    },
    {
      name: "3D Manufacturing Format",
      format: "3mf",
      extension: "3mf",
      mime: "model/3mf",
      from: true,
      to: false,
      internal: "3mf",
      category: "model",
    },
    {
      name: "Blockbench Model JSON",
      format: "blockbench",
      extension: "json",
      mime: "application/json",
      from: true,
      to: true,
      internal: "blockbench",
      category: "model",
    },
    {
      name: "Voxel Grid JSON (Sparse)",
      format: "voxels",
      extension: "json",
      mime: "application/vnd.voxel+json",
      from: true,
      to: false,
      internal: "voxels",
      category: ["model", "voxel"],
    },
    CommonFormats.PNG.supported("png", false, true),
    CommonFormats.JPEG.supported("jpeg", false, true),
    CommonFormats.WEBP.supported("webp", false, true)
  ];
  public ready: boolean = false;

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 4096);
  private renderer = new THREE.WebGLRenderer();

  async init () {
    this.renderer.setSize(960, 540);
    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {

      const blob = new Blob([inputFile.bytes as BlobPart]);
      const url = URL.createObjectURL(blob);

      let object: THREE.Group<THREE.Object3DEventMap>;


      try {
        switch (inputFormat.internal) {
          case "blockbench": {
            const text = new TextDecoder().decode(inputFile.bytes);
            const json = tryParseJson(text);
            object = importBlockbenchObject(json);
            break;
          }
          case "voxels": {
            const text = new TextDecoder().decode(inputFile.bytes);
            const json = tryParseJson(text);
            object = importSparseVoxelGrid(json);
            break;
          }
          case "glb": {
            const gltf: GLTF = await new Promise((resolve, reject) => {
              const loader = new GLTFLoader();
              loader.load(url, resolve, undefined, reject);
            });
            object = gltf.scene;
            break;
          }
          case "obj":
            object = await new Promise((resolve, reject) => {
              const loader = new OBJLoader();
              loader.load(url, resolve, undefined, reject);
            });
            break;
          case "stl": {
            const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
              const loader = new STLLoader();
              loader.load(url, resolve, undefined, reject);
            });
            const material = new THREE.MeshNormalMaterial();
            const mesh = new THREE.Mesh(geometry, material);
            object = new THREE.Group();
            object.add(mesh);
            break;
          }
          case "ply": {
            const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
              const loader = new PLYLoader();
              loader.load(url, resolve, undefined, reject);
            });
            geometry.computeVertexNormals();
            const material = new THREE.MeshNormalMaterial();
            const mesh = new THREE.Mesh(geometry, material);
            object = new THREE.Group();
            object.add(mesh);
            break;
          }
          case "dae": {
            const collada = await new Promise<any>((resolve, reject) => {
              const loader = new ColladaLoader();
              loader.load(url, resolve, undefined, reject);
            });
            object = collada.scene;
            break;
          }
          case "fbx": {
            object = await new Promise((resolve, reject) => {
              const loader = new FBXLoader();
              loader.load(url, resolve, undefined, reject);
            });
            break;
          }
          case "3mf": {
            object = await new Promise((resolve, reject) => {
              const loader = new ThreeMFLoader();
              loader.load(url, resolve, undefined, reject);
            });
            break;
          }
          default:
            throw new Error("Invalid input format");
        }
      } finally {
        URL.revokeObjectURL(url);
      }

      if (outputFormat.internal === "stl") {
        const exporter = new STLExporter();
        const stl = exporter.parse(object, { binary: true });
        const bytes = (() => {
          if (typeof stl === "string") return new TextEncoder().encode(stl);
          if (stl instanceof ArrayBuffer) return new Uint8Array(stl);
          // Some three.js versions type binary output as DataView.
          const view = stl as ArrayBufferView;
          return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        })();
        const name = inputFile.name.split(".")[0] + "." + outputFormat.extension;
        outputFiles.push({ bytes, name });
        continue;
      }

      if (outputFormat.internal === "obj") {
        const exporter = new OBJExporter();
        const obj = exporter.parse(object);
        const bytes = new TextEncoder().encode(obj);
        const name = inputFile.name.split(".")[0] + "." + outputFormat.extension;
        outputFiles.push({ bytes, name });
        continue;
      }

      if (outputFormat.internal === "glb") {
        const exporter = new GLTFExporter();
        const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
          exporter.parse(
            object,
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
        const name = inputFile.name.split(".")[0] + "." + outputFormat.extension;
        outputFiles.push({ bytes: new Uint8Array(glb), name });
        continue;
      }

      if (outputFormat.internal === "ply") {
        const exporter = new PLYExporter();
        const ply = await new Promise<string | ArrayBuffer | null>((resolve) => {
          exporter.parse(object, resolve, { binary: true });
        });
        if (ply === null) throw new Error("PLY export failed");
        const bytes = (() => {
          if (typeof ply === "string") return new TextEncoder().encode(ply);
          if (ply instanceof ArrayBuffer) return new Uint8Array(ply);
          const view = ply as unknown as ArrayBufferView;
          return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        })();
        const name = inputFile.name.split(".")[0] + "." + outputFormat.extension;
        outputFiles.push({ bytes, name });
        continue;
      }

      if (outputFormat.internal === "blockbench") {
        const bytes = exportBlockbenchFromObject(object);
        const name = inputFile.name.split(".")[0] + "." + outputFormat.extension;
        outputFiles.push({ bytes, name });
        continue;
      }

      const bbox = new THREE.Box3().setFromObject(object);
      const center = bbox.getCenter(new THREE.Vector3());
      bbox.getCenter(this.camera.position);
      this.camera.position.z = bbox.max.z * 2;
      this.camera.lookAt(center);

      this.scene.background = new THREE.Color(0x424242);
      this.scene.add(object);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(object);

      const bytes: Uint8Array = await new Promise((resolve, reject) => {
        this.renderer.domElement.toBlob((blob) => {
          if (!blob) return reject("Canvas output failed");
          blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
        }, outputFormat.mime);
      });
      const name = inputFile.name.split(".")[0] + "." + outputFormat.extension;
      outputFiles.push({ bytes, name });

    }

    return outputFiles;
  }

}

export default threejsHandler;
