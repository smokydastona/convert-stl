import CommonFormats from "src/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

import { exportMeshToDxfBytes } from "src/convert/three_d/dxf.ts";

const DEFAULT_THRESHOLD = 0.05;
const MIN_TRI_SUM = 0.5 / 255; // same intent as img2mesh (values there are 0..255)

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

function luma01(r: number, g: number, b: number, a: number): number {
  // sRGB luminance-ish; alpha zeros out height.
  const alpha = a / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (lum / 255) * alpha;
}

function heightfieldMeshFromImageData(img: ImageData, threshold: number): THREE.Mesh {
  const { width, height, data } = img;
  if (width < 2 || height < 2) throw new Error("Image too small for meshing");

  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      heights[y * width + x] = luma01(data[i], data[i + 1], data[i + 2], data[i + 3]);
    }
  }

  const scaleXY = 1 / Math.max(width - 1, height - 1);

  const positions: number[] = [];

  const pushTri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  const xOut = (x: number) => x * scaleXY;
  const yOut = (y: number) => -y * scaleXY; // flip to make +Y up

  // Top surface (img2mesh-style “pyramids” per 2x2 cell)
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const v1 = heights[y * width + x];
      const v2 = heights[y * width + (x + 1)];
      const v3 = heights[(y + 1) * width + (x + 1)];
      const v4 = heights[(y + 1) * width + x];

      if (v1 + v2 + v3 + v4 <= MIN_TRI_SUM) continue;

      const maxV = Math.max(v1, v2, v3, v4);
      const minV = Math.min(v1, v2, v3, v4);
      const contrast = maxV - minV;

      let v0: number;
      if (contrast > threshold) {
        const d13 = Math.abs(v1 - v3);
        const d24 = Math.abs(v2 - v4);
        v0 = d24 < d13 ? (v2 + v4) / 2 : (v1 + v3) / 2;
      } else {
        v0 = (v1 + v2 + v3 + v4) / 4;
      }

      const x0 = xOut(x);
      const x1 = xOut(x + 1);
      const xc = xOut(x + 0.5);
      const y0 = yOut(y);
      const y1 = yOut(y + 1);
      const yc = yOut(y + 0.5);

      // Same topology as img2mesh: 4 triangles around a center point.
      if (v1 + v2 + v0 > MIN_TRI_SUM) pushTri(x0, y0, v1, x1, y0, v2, xc, yc, v0);
      if (v2 + v3 + v0 > MIN_TRI_SUM) pushTri(x1, y0, v2, x1, y1, v3, xc, yc, v0);
      if (v3 + v4 + v0 > MIN_TRI_SUM) pushTri(x1, y1, v3, x0, y1, v4, xc, yc, v0);
      if (v4 + v1 + v0 > MIN_TRI_SUM) pushTri(x0, y1, v4, x0, y0, v1, xc, yc, v0);
    }
  }

  // Sides (close the shape for printing)
  const wall = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    // Quad (A->B top, and A0/B0 at z=0)
    const a0z = 0;
    const b0z = 0;
    // Two triangles
    pushTri(ax, ay, az, bx, by, bz, bx, by, b0z);
    pushTri(ax, ay, az, bx, by, b0z, ax, ay, a0z);
  };

  // Top edge y=0
  for (let x = 0; x < width - 1; x++) {
    const az = heights[0 * width + x];
    const bz = heights[0 * width + (x + 1)];
    wall(xOut(x), yOut(0), az, xOut(x + 1), yOut(0), bz);
  }
  // Bottom edge y=height-1
  for (let x = 0; x < width - 1; x++) {
    const az = heights[(height - 1) * width + (x + 1)];
    const bz = heights[(height - 1) * width + x];
    wall(xOut(x + 1), yOut(height - 1), az, xOut(x), yOut(height - 1), bz);
  }
  // Left edge x=0
  for (let y = 0; y < height - 1; y++) {
    const az = heights[(y + 1) * width + 0];
    const bz = heights[y * width + 0];
    wall(xOut(0), yOut(y + 1), az, xOut(0), yOut(y), bz);
  }
  // Right edge x=width-1
  for (let y = 0; y < height - 1; y++) {
    const az = heights[y * width + (width - 1)];
    const bz = heights[(y + 1) * width + (width - 1)];
    wall(xOut(width - 1), yOut(y), az, xOut(width - 1), yOut(y + 1), bz);
  }

  // Bottom face
  const xMin = xOut(0);
  const xMax = xOut(width - 1);
  const yMin = yOut(height - 1);
  const yMax = yOut(0);
  pushTri(xMin, yMin, 0, xMax, yMin, 0, xMax, yMax, 0);
  pushTri(xMin, yMin, 0, xMax, yMax, 0, xMin, yMax, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.center();

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

async function exportMesh(mesh: THREE.Mesh, outputFormat: FileFormat): Promise<Uint8Array> {
  switch (outputFormat.internal) {
    case "stl": {
      const exporter = new STLExporter();
      const stl = exporter.parse(mesh, { binary: true });
      return normalizeBinary(stl);
    }
    case "obj": {
      const exporter = new OBJExporter();
      const obj = exporter.parse(mesh);
      return new TextEncoder().encode(obj);
    }
    case "glb": {
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
      return new Uint8Array(glb);
    }
    case "dxf":
      return exportMeshToDxfBytes(mesh);
    default:
      throw new Error("Invalid output format");
  }
}

class img2meshHandler implements FormatHandler {
  public name = "img2mesh";
  public supportedFormats?: FileFormat[];
  public ready = false;

  async init() {
    this.supportedFormats = [
      CommonFormats.PNG.builder("png").allowFrom(),
      CommonFormats.JPEG.builder("jpeg").allowFrom(),
      CommonFormats.WEBP.builder("webp").allowFrom(),
      {
        name: "Stereolithography (Heightfield)",
        format: "stl",
        extension: "stl",
        mime: "model/stl",
        from: false,
        to: true,
        internal: "stl",
        category: "model",
        lossless: true,
      },
      {
        name: "Wavefront OBJ (Heightfield)",
        format: "obj",
        extension: "obj",
        mime: "model/obj",
        from: false,
        to: true,
        internal: "obj",
        category: "model",
        lossless: true,
      },
      {
        name: "GLB (Heightfield)",
        format: "glb",
        extension: "glb",
        mime: "model/gltf-binary",
        from: false,
        to: true,
        internal: "glb",
        category: "model",
        lossless: true,
      },
      CommonFormats.DXF.builder("dxf").named("DXF (Heightfield)").allowTo().markLossless(true),
    ];
    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    if (!this.supportedFormats?.some((f) => f.internal === outputFormat.internal)) throw new Error("Invalid output format");
    if (!this.supportedFormats?.some((f) => f.internal === inputFormat.internal && f.from)) throw new Error("Invalid input format");

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const imageData = await decodeToImageData(inputFile.bytes, inputFormat.mime);
      const mesh = heightfieldMeshFromImageData(imageData, DEFAULT_THRESHOLD);
      const bytes = await exportMesh(mesh, outputFormat);
      const baseName = inputFile.name.split(".")[0];
      outputFiles.push({ name: `${baseName}.${outputFormat.extension}`, bytes });
    }

    return outputFiles;
  }
}

export default img2meshHandler;
