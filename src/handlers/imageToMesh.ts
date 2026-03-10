import { imageTracer } from "imagetracer";

import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import CommonFormats from "src/CommonFormats.ts";

import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { exportMeshToDxfBytes } from "src/convert/three_d/dxf.ts";

const DEFAULT_THICKNESS = 2.0;
const MAX_PATHS = 250;
const MAX_POINTS_PER_PATH = 600;

type Polygon2 = {
  points: THREE.Vector2[];
  areaAbs: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

function createSterileSvgRoot(svgText: string): { svgEl: SVGSVGElement; dispose: () => void } {
  const dummy = document.createElement("div");
  dummy.style.all = "initial";
  dummy.style.visibility = "hidden";
  dummy.style.position = "fixed";
  document.body.appendChild(dummy);

  const shadow = dummy.attachShadow({ mode: "closed" });
  const container = document.createElement("div");
  container.innerHTML = svgText;
  shadow.appendChild(container);

  const svgEl = container.querySelector("svg");
  if (!svgEl) throw new Error("Invalid SVG: missing <svg> root");
  return { svgEl: svgEl as SVGSVGElement, dispose: () => dummy.remove() };
}

function signedArea(points: THREE.Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function computeBBox(points: THREE.Vector2[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  // Ray casting
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + 0.0) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function simplifyPolyline(points: THREE.Vector2[], epsilon = 0.25): THREE.Vector2[] {
  if (points.length <= 3) return points;
  const out: THREE.Vector2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (prev.distanceTo(cur) >= epsilon) out.push(cur);
  }
  if (out.length >= 3 && out[0].distanceTo(out[out.length - 1]) < epsilon) {
    out.pop();
  }
  return out;
}

function extractPolygonsFromSvg(svgEl: SVGSVGElement): Polygon2[] {
  const paths = Array.from(svgEl.querySelectorAll("path")) as SVGPathElement[];
  const limited = paths.slice(0, MAX_PATHS);
  const polygons: Polygon2[] = [];

  for (const path of limited) {
    const total = path.getTotalLength();
    if (!Number.isFinite(total) || total <= 1) continue;

    const steps = Math.min(MAX_POINTS_PER_PATH, Math.max(24, Math.ceil(total / 2)));
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < steps; i++) {
      const p = path.getPointAtLength((i / steps) * total);
      // Flip Y to make +Y upwards in 3D space
      pts.push(new THREE.Vector2(p.x, -p.y));
    }

    const simplified = simplifyPolyline(pts);
    if (simplified.length < 3) continue;

    const areaAbs = Math.abs(signedArea(simplified));
    if (!Number.isFinite(areaAbs) || areaAbs <= 0.5) continue;

    polygons.push({
      points: simplified,
      areaAbs,
      bbox: computeBBox(simplified),
    });
  }

  // Prefer larger polygons first
  polygons.sort((a, b) => b.areaAbs - a.areaAbs);
  return polygons;
}

function polygonsToExtrudedMesh(polygons: Polygon2[], thickness: number): THREE.Mesh {
  if (polygons.length === 0) throw new Error("No polygons extracted.");

  // Partition into outers + holes by containment.
  // Anything contained within a larger polygon is treated as a hole.
  const outers: Array<{ poly: Polygon2; holes: Polygon2[] }> = [];

  for (const poly of polygons) {
    const testPoint = poly.points[0];
    let containerIndex: number | null = null;
    let containerArea = Infinity;

    for (let i = 0; i < outers.length; i++) {
      const outer = outers[i].poly;
      if (
        testPoint.x < outer.bbox.minX ||
        testPoint.x > outer.bbox.maxX ||
        testPoint.y < outer.bbox.minY ||
        testPoint.y > outer.bbox.maxY
      ) {
        continue;
      }
      if (pointInPolygon(testPoint, outer.points) && outer.areaAbs < containerArea) {
        containerIndex = i;
        containerArea = outer.areaAbs;
      }
    }

    if (containerIndex === null) {
      outers.push({ poly, holes: [] });
    } else {
      outers[containerIndex].holes.push(poly);
    }
  }

  const geometries: THREE.BufferGeometry[] = [];

  for (const { poly, holes } of outers) {
    const shape = new THREE.Shape(poly.points);
    for (const hole of holes) {
      shape.holes.push(new THREE.Path(hole.points));
    }

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 6,
      steps: 1,
    });
    geometries.push(geom);
  }

  let merged: THREE.BufferGeometry;
  if (geometries.length === 1) {
    merged = geometries[0];
  } else {
    merged = mergeGeometries(geometries, false) ?? geometries[0];
  }

  // Cleanup-ish: merge vertices + normals + center
  merged = mergeVertices(merged, 1e-4);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.center();

  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial());
  return mesh;
}

function exportBlockbenchFromMesh(mesh: THREE.Mesh, voxelSize = 1.0, maxCubes = 5000): Uint8Array {
  const geom = mesh.geometry;
  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  if (!bbox) throw new Error("Missing bounding box");

  const pos = geom.getAttribute("position");
  const seen = new Set<string>();
  const cubes: any[] = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + mesh.position.x;
    const y = pos.getY(i) + mesh.position.y;
    const z = pos.getZ(i) + mesh.position.z;
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

async function exportMesh(mesh: THREE.Mesh, outputFormat: FileFormat): Promise<Uint8Array> {
  switch (outputFormat.internal) {
    case "stl": {
      const exporter = new STLExporter();
      const stl = exporter.parse(mesh, { binary: true });
      if (typeof stl === "string") return new TextEncoder().encode(stl);
      if (stl instanceof ArrayBuffer) return new Uint8Array(stl);
      const view = stl as ArrayBufferView;
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
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
            // Some builds may return JSON for non-binary; enforce binary.
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
    case "blockbench":
      return exportBlockbenchFromMesh(mesh);
    default:
      throw new Error("Invalid output format");
  }
}

class imageToMeshHandler implements FormatHandler {
  public name: string = "imageToMesh";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;

  async init() {
    this.supportedFormats = [
      CommonFormats.PNG.builder("png").allowFrom(),
      CommonFormats.JPEG.builder("jpeg").allowFrom(),
      CommonFormats.WEBP.builder("webp").allowFrom(),
      CommonFormats.SVG.builder("svg").allowFrom(),
      {
        name: "Stereolithography",
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
        name: "Waveform OBJ",
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
        name: "GL Transmission Format Binary",
        format: "glb",
        extension: "glb",
        mime: "model/gltf-binary",
        from: false,
        to: true,
        internal: "glb",
        category: "model",
        lossless: true,
      },
      CommonFormats.DXF.builder("dxf").allowTo().markLossless(true),
      {
        name: "Blockbench Model JSON",
        format: "blockbench",
        extension: "json",
        mime: "application/json",
        from: false,
        to: true,
        internal: "blockbench",
        category: "model",
        lossless: false,
      },
    ];
    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    if (!["png", "jpeg", "webp", "svg"].includes(inputFormat.internal)) throw new Error("Invalid input format");
    if (!["stl", "obj", "glb", "dxf", "blockbench"].includes(outputFormat.internal)) throw new Error("Invalid output format");

    const outputFiles: FileData[] = [];
    const decoder = new TextDecoder();

    for (const inputFile of inputFiles) {
      let svgText: string;

      if (inputFormat.internal === "svg") {
        svgText = decoder.decode(inputFile.bytes);
      } else {
        const blob = new Blob([inputFile.bytes as BlobPart], { type: inputFormat.mime });
        const url = URL.createObjectURL(blob);
        try {
          svgText = await imageTracer.imageToSVG(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      const { svgEl, dispose } = createSterileSvgRoot(svgText);
      const polygons = extractPolygonsFromSvg(svgEl);
      dispose();
      const mesh = polygonsToExtrudedMesh(polygons, DEFAULT_THICKNESS);

      const bytes = await exportMesh(mesh, outputFormat);
      const name = inputFile.name.split(".")[0] + "." + outputFormat.extension;
      outputFiles.push({ bytes, name });
    }

    return outputFiles;
  }
}

export default imageToMeshHandler;
