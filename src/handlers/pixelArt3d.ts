import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import CommonFormats from "src/CommonFormats.ts";

import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

import { exportMinecraftSchemBytes } from "src/convert/three_d/minecraft.ts";
import { pixelArtHeightMeshFromRgba } from "src/convert/three_d/pixelArtHeight.ts";
import { exportMeshToDxfBytes } from "src/convert/three_d/dxf.ts";

function normalizeBinary(result: unknown): Uint8Array {
  if (typeof result === "string") return new TextEncoder().encode(result);
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  const view = result as ArrayBufferView;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

async function decodeToImageData(bytes: Uint8Array, mime: string): Promise<ImageData> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bmp.close();
  }
}

async function exportMesh(mesh: THREE.Mesh, outputFormat: FileFormat, baseName: string): Promise<FileData> {
  if (outputFormat.internal === "pixelart-stl") {
    const exporter = new STLExporter();
    const stl = exporter.parse(mesh, { binary: true });
    return { name: `${baseName}.stl`, bytes: normalizeBinary(stl) };
  }

  if (outputFormat.internal === "pixelart-obj") {
    const exporter = new OBJExporter();
    const obj = exporter.parse(mesh);
    return { name: `${baseName}.obj`, bytes: new TextEncoder().encode(obj) };
  }

  if (outputFormat.internal === "pixelart-glb") {
    const exporter = new GLTFExporter();
    const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        mesh,
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
    return { name: `${baseName}.glb`, bytes: new Uint8Array(glb) };
  }

  if (outputFormat.internal === "pixelart-schem") {
    const bytes = await exportMinecraftSchemBytes(mesh, {
      // Keep defaults; this produces a sensible solid schematic.
    });
    return { name: `${baseName}.schem`, bytes };
  }

  if (outputFormat.internal === "pixelart-dxf") {
    const bytes = exportMeshToDxfBytes(mesh);
    return { name: `${baseName}.dxf`, bytes };
  }

  throw new Error("Invalid output format");
}

class PixelArt3dHandler implements FormatHandler {
  public name = "pixelArt3d";
  public supportedFormats?: FileFormat[];
  public ready = false;

  async init() {
    this.supportedFormats = [
      CommonFormats.PNG.builder("png").allowFrom(),
      {
        name: "Pixel Art STL (Color Height)",
        format: "stl",
        extension: "stl",
        mime: "model/stl",
        from: false,
        to: true,
        internal: "pixelart-stl",
        category: "model",
        lossless: true,
      },
      {
        name: "Pixel Art OBJ (Color Height)",
        format: "obj",
        extension: "obj",
        mime: "model/obj",
        from: false,
        to: true,
        internal: "pixelart-obj",
        category: "model",
        lossless: true,
      },
      {
        name: "Pixel Art GLB (Color Height)",
        format: "glb",
        extension: "glb",
        mime: "model/gltf-binary",
        from: false,
        to: true,
        internal: "pixelart-glb",
        category: "model",
        lossless: true,
      },
      CommonFormats.DXF.builder("pixelart-dxf").named("Pixel Art DXF (Color Height)").allowTo().markLossless(true),
      {
        name: "Pixel Art Sponge Schematic (Color Height)",
        format: "schem",
        extension: "schem",
        mime: "application/x-minecraft-schem",
        from: false,
        to: true,
        internal: "pixelart-schem",
        category: "data",
        lossless: true,
      },
    ];
    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    if (inputFormat.internal !== "png") throw new Error("Invalid input format");
    if (!this.supportedFormats?.some((f) => f.internal === outputFormat.internal)) throw new Error("Invalid output format");

    const outputFiles: FileData[] = [];
    for (const inputFile of inputFiles) {
      const imageData = await decodeToImageData(inputFile.bytes, inputFormat.mime);
      const mesh = pixelArtHeightMeshFromRgba(imageData.width, imageData.height, imageData.data);
      const baseName = inputFile.name.split(".")[0];
      outputFiles.push(await exportMesh(mesh, outputFormat, baseName));
    }
    return outputFiles;
  }
}

export default PixelArt3dHandler;
