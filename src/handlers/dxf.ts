import CommonFormats from "src/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

import DxfParser from "dxf-parser";

type Point = { x: number; y: number };

type BBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function createEmptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function expandBBox(bbox: BBox, x: number, y: number) {
  if (x < bbox.minX) bbox.minX = x;
  if (y < bbox.minY) bbox.minY = y;
  if (x > bbox.maxX) bbox.maxX = x;
  if (y > bbox.maxY) bbox.maxY = y;
}

function bboxFromPoints(points: Point[]): BBox {
  const bbox = createEmptyBBox();
  for (const p of points) expandBBox(bbox, p.x, p.y);
  return bbox;
}

function clampFiniteBBox(bbox: BBox): BBox {
  if (!Number.isFinite(bbox.minX) || !Number.isFinite(bbox.minY) || !Number.isFinite(bbox.maxX) || !Number.isFinite(bbox.maxY)) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }
  if (bbox.maxX === bbox.minX) bbox.maxX += 1;
  if (bbox.maxY === bbox.minY) bbox.maxY += 1;
  return bbox;
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function pointOnCircle(center: Point, radius: number, angleDeg: number): Point {
  const a = degToRad(angleDeg);
  return { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius };
}

function indexOfAscii(bytes: Uint8Array, ascii: string, from: number = 0): number {
  const needle = new TextEncoder().encode(ascii);
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function toSvg(dxf: any): string {
  const entities: any[] = Array.isArray(dxf?.entities) ? dxf.entities : [];

  const bbox = createEmptyBBox();

  // First pass: compute bbox
  for (const e of entities) {
    const type = String(e?.type ?? "").toUpperCase();
    if (type === "LINE") {
      expandBBox(bbox, e.start?.x ?? 0, e.start?.y ?? 0);
      expandBBox(bbox, e.end?.x ?? 0, e.end?.y ?? 0);
    } else if (type === "LWPOLYLINE") {
      const pts: Point[] = (e.vertices ?? []).map((v: any) => ({ x: v.x ?? 0, y: v.y ?? 0 }));
      const b = bboxFromPoints(pts);
      expandBBox(bbox, b.minX, b.minY);
      expandBBox(bbox, b.maxX, b.maxY);
    } else if (type === "POLYLINE") {
      const pts: Point[] = (e.vertices ?? []).map((v: any) => ({ x: v.x ?? 0, y: v.y ?? 0 }));
      const b = bboxFromPoints(pts);
      expandBBox(bbox, b.minX, b.minY);
      expandBBox(bbox, b.maxX, b.maxY);
    } else if (type === "CIRCLE") {
      const cx = e.center?.x ?? 0;
      const cy = e.center?.y ?? 0;
      const r = e.radius ?? 0;
      expandBBox(bbox, cx - r, cy - r);
      expandBBox(bbox, cx + r, cy + r);
    } else if (type === "ARC") {
      const cx = e.center?.x ?? 0;
      const cy = e.center?.y ?? 0;
      const r = e.radius ?? 0;
      const start = Number(e.startAngle ?? 0);
      const end = Number(e.endAngle ?? 0);

      // Sample points along the arc to approximate bbox
      const steps = 32;
      const sweep = ((end - start) % 360 + 360) % 360;
      const total = sweep === 0 ? 360 : sweep;
      for (let i = 0; i <= steps; i++) {
        const a = start + (total * i) / steps;
        const p = pointOnCircle({ x: cx, y: cy }, r, a);
        expandBBox(bbox, p.x, p.y);
      }
    } else if (type === "TEXT" || type === "MTEXT") {
      // Text bbox is font-dependent; include insertion point so it doesn't get dropped completely.
      expandBBox(bbox, e.startPoint?.x ?? e.position?.x ?? 0, e.startPoint?.y ?? e.position?.y ?? 0);
    }
  }

  const safeBBox = clampFiniteBBox(bbox);
  const pad = Math.max(1, Math.max(safeBBox.maxX - safeBBox.minX, safeBBox.maxY - safeBBox.minY) * 0.02);
  const minX = safeBBox.minX - pad;
  const minY = safeBBox.minY - pad;
  const maxX = safeBBox.maxX + pad;
  const maxY = safeBBox.maxY + pad;
  const width = maxX - minX;
  const height = maxY - minY;

  // DXF uses +Y up; SVG uses +Y down. Flip Y by negating y values and adjusting viewBox.
  const viewBox = `${minX} ${-maxY} ${width} ${height}`;

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`);
  parts.push(`<g fill="none" stroke="black" stroke-width="1">`);

  for (const e of entities) {
    const type = String(e?.type ?? "").toUpperCase();

    if (type === "LINE") {
      const x1 = e.start?.x ?? 0;
      const y1 = -(e.start?.y ?? 0);
      const x2 = e.end?.x ?? 0;
      const y2 = -(e.end?.y ?? 0);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`);
      continue;
    }

    if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const pts: Point[] = (e.vertices ?? []).map((v: any) => ({ x: v.x ?? 0, y: v.y ?? 0 }));
      if (pts.length === 0) continue;
      const pointsAttr = pts.map(p => `${p.x},${-p.y}`).join(" ");
      const isClosed = !!e.shape || !!e.closed;
      if (isClosed) parts.push(`<polygon points="${pointsAttr}" />`);
      else parts.push(`<polyline points="${pointsAttr}" />`);
      continue;
    }

    if (type === "CIRCLE") {
      const cx = e.center?.x ?? 0;
      const cy = -(e.center?.y ?? 0);
      const r = e.radius ?? 0;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" />`);
      continue;
    }

    if (type === "ARC") {
      const cx = e.center?.x ?? 0;
      const cy = e.center?.y ?? 0;
      const r = e.radius ?? 0;
      const start = Number(e.startAngle ?? 0);
      const end = Number(e.endAngle ?? 0);

      const sweep = ((end - start) % 360 + 360) % 360;
      const total = sweep === 0 ? 360 : sweep;

      const p1 = pointOnCircle({ x: cx, y: cy }, r, start);
      const p2 = pointOnCircle({ x: cx, y: cy }, r, start + total);
      const largeArcFlag = total > 180 ? 1 : 0;
      // DXF angles are CCW; after Y flip, sweep direction flips.
      const sweepFlag = 0;

      const x1 = p1.x;
      const y1 = -p1.y;
      const x2 = p2.x;
      const y2 = -p2.y;
      parts.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${x2} ${y2}" />`);
      continue;
    }

    if (type === "TEXT" || type === "MTEXT") {
      const text = String(e.text ?? e.string ?? "");
      if (!text) continue;

      const x = e.startPoint?.x ?? e.position?.x ?? 0;
      const y = -(e.startPoint?.y ?? e.position?.y ?? 0);
      const fontSize = Number(e.textHeight ?? e.height ?? 12);

      // Basic escaping for XML text nodes
      const escaped = text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");

      parts.push(`<text x="${x}" y="${y}" font-size="${fontSize}" fill="black" stroke="none">${escaped}</text>`);
      continue;
    }
  }

  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

class dxfHandler implements FormatHandler {
  public name: string = "dxf";

  public supportedFormats: FileFormat[] = [
    CommonFormats.DXF.builder("dxf").allowFrom(),
    CommonFormats.SVG.builder("svg").allowTo(),
    CommonFormats.JSON.builder("json").allowTo(),
  ];

  public ready: boolean = true;

  async init() {
    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    if (inputFormat.internal !== "dxf") throw "Invalid input format.";

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const dxfText = decoder.decode(inputFile.bytes);

      // Basic sanity check: reject obviously non-DXF input early.
      // DXF often starts with a group code and section headers.
      if (indexOfAscii(inputFile.bytes, "SECTION") === -1 && indexOfAscii(inputFile.bytes, "ENTITIES") === -1) {
        // Still attempt parse, but error message is nicer when it fails.
      }

      const parser: any = new (DxfParser as any)();
      const dxf = typeof parser.parseSync === "function" ? parser.parseSync(dxfText) : parser.parse(dxfText);

      const baseName = inputFile.name.split(".")[0];

      if (outputFormat.internal === "json") {
        const json = JSON.stringify(dxf, null, 2);
        outputFiles.push({ name: `${baseName}.json`, bytes: encoder.encode(json) });
      } else if (outputFormat.internal === "svg") {
        const svg = toSvg(dxf);
        outputFiles.push({ name: `${baseName}.svg`, bytes: encoder.encode(svg) });
      } else {
        throw "Invalid output format.";
      }
    }

    return outputFiles;
  }
}

export default dxfHandler;
