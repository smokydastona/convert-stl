import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import CommonFormats from "src/CommonFormats.ts";

import JSZip from "jszip";
import { Archive } from "libarchive.js";

let libarchiveInitialized = false;

type LibarchiveEntry = {
  path: string;
  name: string;
  size?: number;
  lastModified?: number;
};

async function ensureLibarchiveReady(): Promise<void> {
  if (libarchiveInitialized) return;

  // Worker + wasm are shipped as static assets (see viteStaticCopy).
  Archive.init({
    workerUrl: new URL(`${import.meta.env.BASE_URL}wasm/libarchive/worker-bundle.js`, globalThis.location.href).toString(),
  });

  libarchiveInitialized = true;
}

async function listArchive(file: File): Promise<LibarchiveEntry[]> {
  const archive = await Archive.open(file);
  const entries = await archive.getFilesArray();

  const out: LibarchiveEntry[] = [];
  for (const entry of entries as any[]) {
    const f = entry.file;
    // In list mode, libarchive returns CompressedFile-like objects.
    out.push({
      path: entry.path ?? "",
      name: f?.name ?? "",
      size: f?.size,
      lastModified: f?.lastModified,
    });
  }
  return out;
}

async function archiveToZipBytes(file: File): Promise<Uint8Array> {
  const archive = await Archive.open(file);

  const encrypted = await archive.hasEncryptedData();
  if (encrypted) {
    throw new Error("Encrypted archives are not supported yet (password prompt not implemented).");
  }

  await archive.extractFiles();
  const entries = await archive.getFilesArray();

  const zip = new JSZip();
  for (const entry of entries as any[]) {
    const f = entry.file as File | null | undefined;
    if (!(f instanceof File)) continue;
    const fullPath = `${entry.path ?? ""}${f.name}`;
    const bytes = new Uint8Array(await f.arrayBuffer());
    zip.file(fullPath, bytes, {
      date: typeof f.lastModified === "number" ? new Date(f.lastModified) : undefined,
    });
  }

  return await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

class libarchiveHandler implements FormatHandler {
  public name: string = "libarchive";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;

  async init() {
    await ensureLibarchiveReady();

    this.supportedFormats = [
      {
        name: "7-Zip Archive",
        format: "7z",
        extension: "7z",
        mime: "application/x-7z-compressed",
        from: true,
        to: false,
        internal: "7z",
        category: "archive",
        lossless: true,
      },
      {
        name: "RAR Archive",
        format: "rar",
        extension: "rar",
        mime: "application/vnd.rar",
        from: true,
        to: false,
        internal: "rar",
        category: "archive",
        lossless: true,
      },
      {
        name: "GZip Compressed",
        format: "gz",
        extension: "gz",
        mime: "application/gzip",
        from: true,
        to: false,
        internal: "gz",
        category: "archive",
        lossless: true,
      },
      {
        name: "XZ Compressed",
        format: "xz",
        extension: "xz",
        mime: "application/x-xz",
        from: true,
        to: false,
        internal: "xz",
        category: "archive",
        lossless: true,
      },
      {
        name: "Zstandard Compressed",
        format: "zst",
        extension: "zst",
        mime: "application/zstd",
        from: true,
        to: false,
        internal: "zst",
        category: "archive",
        lossless: true,
      },
      {
        name: "Microsoft Cabinet",
        format: "cab",
        extension: "cab",
        mime: "application/vnd.ms-cab-compressed",
        from: true,
        to: false,
        internal: "cab",
        category: "archive",
        lossless: true,
      },
      {
        name: "ISO 9660 Disk Image",
        format: "iso",
        extension: "iso",
        mime: "application/x-iso9660-image",
        from: true,
        to: false,
        internal: "iso",
        category: "archive",
        lossless: true,
      },
      CommonFormats.ZIP.builder("zip").allowTo().markLossless(),
      CommonFormats.JSON.builder("json").allowTo(),
    ];

    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    if (!this.ready) throw new Error("Handler not initialized");
    if (!this.supportedFormats?.some((f) => f.internal === outputFormat.internal)) throw new Error("Invalid output format");

    if (!["7z", "rar", "gz", "xz", "zst", "cab", "iso"].includes(inputFormat.internal)) {
      throw new Error("Invalid input format");
    }

    await ensureLibarchiveReady();

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      const baseName = inputFile.name.replace(/\.[^.]+$/i, "");
      const file = new File([inputFile.bytes as unknown as BlobPart], inputFile.name, { type: inputFormat.mime || "application/octet-stream" });

      if (outputFormat.internal === "json") {
        const entries = await listArchive(file);
        const json = JSON.stringify({
          archiveName: inputFile.name,
          fileCount: entries.length,
          entries,
        }, null, 2);
        outputFiles.push({ name: `${baseName}.json`, bytes: new TextEncoder().encode(json) });
        continue;
      }

      if (outputFormat.internal === "zip") {
        const bytes = await archiveToZipBytes(file);
        outputFiles.push({ name: `${baseName}.zip`, bytes });
        continue;
      }

      throw new Error("Unsupported output format");
    }

    return outputFiles;
  }
}

export default libarchiveHandler;
