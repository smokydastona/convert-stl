import CommonFormats from "src/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

function findAscii(bytes: Uint8Array, ascii: string, from: number = 0): number {
  const needle = new TextEncoder().encode(ascii);
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function findLastAscii(bytes: Uint8Array, ascii: string): number {
  const needle = new TextEncoder().encode(ascii);
  outer: for (let i = bytes.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function extractEmbeddedPdf(bytes: Uint8Array): Uint8Array | null {
  const pdfStart = findAscii(bytes, "%PDF-");
  if (pdfStart === -1) return null;

  const eof = findLastAscii(bytes, "%%EOF");
  if (eof === -1) {
    return bytes.slice(pdfStart);
  }

  // Include the EOF marker; trailing whitespace is harmless for most PDF consumers.
  return bytes.slice(pdfStart, eof + "%%EOF".length);
}

class adobePdfHandler implements FormatHandler {
  public name: string = "adobePdf";

  public supportedFormats: FileFormat[] = [
    CommonFormats.AI.builder("ai").allowFrom(),
    CommonFormats.EPS.builder("eps").allowFrom(),
    CommonFormats.PDF.builder("pdf").allowTo(),
  ];

  public ready: boolean = true;

  async init() {
    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    if (outputFormat.internal !== "pdf") throw "Invalid output format.";
    if (inputFormat.internal !== "ai" && inputFormat.internal !== "eps") throw "Invalid input format.";

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const pdf = extractEmbeddedPdf(inputFile.bytes);
      if (!pdf) {
        throw "No embedded PDF found. This file may be a legacy (EPS-only) Illustrator/PS file which requires Ghostscript-style rendering.";
      }

      const baseName = inputFile.name.split(".")[0];
      outputFiles.push({ name: `${baseName}.pdf`, bytes: pdf });
    }

    return outputFiles;
  }
}

export default adobePdfHandler;
