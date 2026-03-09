import CommonFormats from "src/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

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
      name: "Blockbench Model JSON",
      format: "blockbench",
      extension: "json",
      mime: "application/json",
      from: false,
      to: true,
      internal: "blockbench",
      category: "model",
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
