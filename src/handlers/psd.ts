import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import CommonFormats from "src/CommonFormats.ts";

import { readPsd } from "ag-psd";

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Canvas output failed"));
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      "image/png",
      1.0
    );
  });
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      // ag-psd attaches canvases to composite + layer nodes.
      if (typeof HTMLCanvasElement !== "undefined" && v instanceof HTMLCanvasElement) return undefined;
      // Remove large binary-ish data if present.
      if (v instanceof Uint8Array) return undefined;
      if (v instanceof ArrayBuffer) return undefined;
      return v;
    },
    2
  );
}

class psdHandler implements FormatHandler {
  public name: string = "psd";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;

  async init() {
    this.supportedFormats = [
      {
        name: "Adobe Photoshop Document",
        format: "psd",
        extension: "psd",
        mime: "image/vnd.adobe.photoshop",
        from: true,
        to: false,
        internal: "psd",
        category: ["image", "design"],
        lossless: true,
      },
      CommonFormats.PNG.builder("png").allowTo().markLossless(),
      CommonFormats.JSON.builder("json").allowTo(),
    ];
    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    if (inputFormat.internal !== "psd") throw new Error("Invalid input format");
    if (!this.supportedFormats?.some((f) => f.internal === outputFormat.internal)) throw new Error("Invalid output format");

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const baseName = inputFile.name.replace(/\.[^.]+$/i, "");

      if (outputFormat.internal === "json") {
        const psd = readPsd(inputFile.bytes, {
          skipLayerImageData: true,
          skipCompositeImageData: true,
          skipThumbnail: true,
        } as any);

        const json = safeJsonStringify(psd);
        outputFiles.push({ name: `${baseName}.json`, bytes: new TextEncoder().encode(json) });
        continue;
      }

      if (outputFormat.internal === "png") {
        const psd = readPsd(inputFile.bytes as any);
        const canvas = (psd as any).canvas as HTMLCanvasElement | undefined;
        if (!canvas) throw new Error("PSD did not include composite image data");
        const bytes = await canvasToPngBytes(canvas);
        outputFiles.push({ name: `${baseName}.png`, bytes });
        continue;
      }

      throw new Error("Unsupported output format");
    }

    return outputFiles;
  }
}

export default psdHandler;
