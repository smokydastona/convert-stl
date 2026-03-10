import { afterAll, expect, test } from "bun:test";
import puppeteer from "puppeteer";
import type { FileData, FormatHandler, FileFormat, ConvertPathNode } from "../src/FormatHandler.js";
import CommonFormats from "../src/CommonFormats.js";

function normalizeBase(base?: string) {
  const raw = (base ?? "/convert/").trim() || "/convert/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

const basePath = normalizeBase(process.env.VITE_BASE);

declare global {
  interface Window {
    queryFormatNode: (testFunction: (value: ConvertPathNode) => boolean) => ConvertPathNode | undefined;
    tryConvertByTraversing: (files: FileData[], from: ConvertPathNode, to: ConvertPathNode) => Promise<{
      files: FileData[];
      path: ConvertPathNode[];
    } | null>;
  }
}

// Set up a basic webserver to host the distribution build
const server = Bun.serve({
  async fetch (req) {
    const url = new URL(req.url);
    const urlPath = url.pathname;

    // Redirect root -> basePath for non-root deployments.
    if (basePath !== "/" && (urlPath === "/" || urlPath === "")) {
      return Response.redirect(`${url.origin}${basePath}`, 302);
    }

    // Serve index for the base path itself.
    if (urlPath === basePath || urlPath === basePath.slice(0, -1)) {
      const indexFile = Bun.file(`${__dirname}/../dist/index.html`);
      if (!(await indexFile.exists())) return new Response("Not Found", { status: 404 });
      return new Response(indexFile, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Map /<base>/... -> dist/...
    let relativePath = urlPath;
    if (relativePath.startsWith(basePath)) {
      relativePath = relativePath.slice(basePath.length);
    } else {
      relativePath = relativePath.replace(/^\/+/, "");
    }

    relativePath = relativePath.replaceAll("..", "");

    if (relativePath.startsWith("test/")) {
      // allow fixtures to be fetched from /test/<name>
      relativePath = "../test/resources/" + relativePath.slice(5);
    }

    if (!relativePath) relativePath = "index.html";

    const file = Bun.file(`${__dirname}/../dist/${relativePath}`);
    if (!(await file.exists())) return new Response("Not Found", { status: 404 });
    return new Response(file);
  },
  port: 8080
});

// Start puppeteer, wait for ready confirmation
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});
const page = await browser.newPage();

page.on("console", (msg) => {
  // Keep output; this test suite depends on the app booting.
  console.log(`[browser:${msg.type()}] ${msg.text()}`);
});

await page.goto(`http://localhost:8080${basePath}index.html`, { waitUntil: "domcontentloaded" });

// Deterministic readiness signal: these globals must exist for the tests.
await page.waitForFunction(
  () => typeof window.tryConvertByTraversing === "function"
    && typeof window.traversionGraph?.getData === "function"
    && window.traversionGraph.getData().nodes.length > 0,
  { timeout: 180000 }
);

console.log("Setup finished.");

const dummyHandler: FormatHandler = {
  name: "dummy",
  ready: true,
  async init () { },
  async doConvert (inputFiles, inputFormat, outputFormat, args) {
    return [];
  }
};

function attemptConversion (
  files: string[],
  from: FileFormat,
  to: FileFormat
) {
  return page.evaluate(async (testFileNames, from, to) => {
    const files: FileData[] = [];
    for (const fileName of testFileNames) {
      files.push({
        bytes: await fetch("/test/" + fileName).then(r => r.bytes()),
        name: fileName
      });
    }
    return await window.tryConvertByTraversing(files, from, to);
  },
    files,
    { format: from, handler: dummyHandler },
    { format: to, handler: dummyHandler }
  );
}

// ==================================================================
//                         START OF TESTS
// ==================================================================

test("png → jpeg", async () => {

  const conversion = await attemptConversion(
    ["colors_50x50.png"],
    CommonFormats.PNG,
    CommonFormats.JPEG
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual(["image/png", "image/jpeg"]);

}, { timeout: 60000 });

test("png → svg", async () => {

  const conversion = await attemptConversion(
    ["colors_50x50.png"],
    CommonFormats.PNG,
    CommonFormats.SVG
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual(["image/png", "image/svg+xml"]);

}, { timeout: 60000 });

test("mp4 → apng", async () => {

  const conversion = await attemptConversion(
    ["doom.mp4"],
    CommonFormats.MP4,
    CommonFormats.PNG.builder("apng").withFormat("apng")
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.format)).toEqual(["mp4", "apng"]);
  expect(conversion?.files.length).toBe(1);

}, { timeout: 60000 });

test("png → mp4", async () => {

  const conversion = await attemptConversion(
    ["colors_50x50.png"],
    CommonFormats.PNG,
    CommonFormats.MP4
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual(["image/png", "video/mp4"]);

}, { timeout: 60000 });

test("png → wav → mp3", async () => {

  const conversion = await attemptConversion(
    ["colors_50x50.png"],
    CommonFormats.PNG,
    CommonFormats.MP3
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual(["image/png", "audio/wav", "audio/mpeg"]);

}, { timeout: 60000 });

test("mp3 → png → gif", async () => {

  const conversion = await attemptConversion(
    ["gaster.mp3"],
    CommonFormats.MP3,
    CommonFormats.GIF
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual(["audio/mpeg", "image/png", "image/gif"]);

}, { timeout: 60000 });

test("docx → html → svg → png → pdf", async () => {

  const conversion = await attemptConversion(
    ["word.docx"],
    CommonFormats.DOCX,
    CommonFormats.PDF
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/html", "image/svg+xml", "image/png", "application/pdf"
  ]);
  const byteValues = Object.values(conversion!.files[0].bytes) as number[];
  expect(byteValues.length).toBeGreaterThan(20000);
  expect(String.fromCharCode(...byteValues.slice(0, 4))).toBe("%PDF");

}, { timeout: 60000 });

test("md → docx", async () => {

  const conversion = await attemptConversion(
    ["markdown.md"],
    CommonFormats.MD,
    CommonFormats.DOCX
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual([
    "text/markdown", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ]);

}, { timeout: 60000 });

test("txt → wav → flac", async () => {

  const conversion = await attemptConversion(
    ["markdown.md"],
    CommonFormats.TEXT,
    CommonFormats.FLAC
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual([
    "text/plain", "audio/wav", "audio/flac"
  ]);
  expect(conversion!.path[1].handler.name).toBe("espeakng");

}, { timeout: 60000 });

test("no unreachable output is selectable for a chosen input", async () => {
  const result = await page.evaluate(() => {
    const data = window.traversionGraph.getData();
    const n = data.nodes.length;
    const adj: number[][] = Array.from({ length: n }, () => []);
    const idToIndex = new Map<string, number>();
    for (let i = 0; i < n; i++) idToIndex.set(data.nodes[i].identifier, i);
    for (const e of data.edges) adj[e.from.index].push(e.to.index);

    function reachableFrom(id: string) {
      const start = idToIndex.get(id);
      if (start === undefined) return new Set<string>();
      const seen = new Uint8Array(n);
      const stack: number[] = [start];
      seen[start] = 1;
      while (stack.length) {
        const v = stack.pop()!;
        for (const next of adj[v]) {
          if (!seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
      const out = new Set<string>();
      for (let i = 0; i < n; i++) if (seen[i]) out.add(data.nodes[i].identifier);
      return out;
    }

    const inputButtonsAll = Array.from(document.querySelectorAll("#from-list button")) as HTMLButtonElement[];
    const outputButtonsAll = Array.from(document.querySelectorAll("#to-list button")) as HTMLButtonElement[];

    const sample = <T,>(arr: T[], max: number): T[] => {
      if (arr.length <= max) return arr;
      const step = Math.max(1, Math.floor(arr.length / max));
      const out: T[] = [];
      for (let i = 0; i < arr.length && out.length < max; i += step) out.push(arr[i]);
      return out;
    };

    const inputButtons = sample(inputButtonsAll, 40);
    const outputButtons = sample(outputButtonsAll, 80);

    const failures: Array<{ input: string; output: string; reason: string }> = [];
    for (const inBtn of inputButtons) {
      const inId = inBtn.getAttribute("format-id") ?? "";
      if (!inId) continue;

      // Trigger app logic to disable unreachable outputs.
      inBtn.click();

      const reachable = reachableFrom(inId);
      for (const outBtn of outputButtons) {
        const outId = outBtn.getAttribute("format-id") ?? "";
        if (!outId) continue;
        const uiDisabled = outBtn.classList.contains("disabled");
        const graphReachable = reachable.has(outId);

        if (!graphReachable && !uiDisabled) {
          failures.push({ input: inId, output: outId, reason: "unreachable output is enabled" });
        }
        if (graphReachable && uiDisabled) {
          failures.push({ input: inId, output: outId, reason: "reachable output is disabled" });
        }
        if (failures.length > 25) break;
      }
      if (failures.length > 25) break;
    }

    return { ok: failures.length === 0, failures: failures.slice(0, 10) };
  });

  expect(result.ok).toBe(true);
}, { timeout: 180000 });

test("dxf → svg", async () => {

  const conversion = await attemptConversion(
    ["simple_triangle.dxf"],
    CommonFormats.DXF,
    CommonFormats.SVG
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path.map(c => c.format.mime)).toEqual(["image/vnd.dxf", "image/svg+xml"]);
  expect(conversion?.files.length).toBe(1);

  const bytes = Uint8Array.from(Object.values(conversion!.files[0].bytes) as number[]);
  const svgText = new TextDecoder().decode(bytes);
  expect(svgText).toContain("<svg");

}, { timeout: 60000 });

test("png → dxf", async () => {

  const conversion = await attemptConversion(
    ["colors_50x50.png"],
    CommonFormats.PNG,
    CommonFormats.DXF
  );

  expect(conversion).toBeTruthy();
  expect(conversion!.path[0].format.mime).toBe("image/png");
  expect(conversion!.path[conversion!.path.length - 1].format.mime).toBe("image/vnd.dxf");
  expect(conversion?.files.length).toBe(1);

  const bytes = Uint8Array.from(Object.values(conversion!.files[0].bytes) as number[]);
  const dxfText = new TextDecoder().decode(bytes);
  expect(dxfText).toContain("SECTION");
  expect(dxfText).toContain("ENTITIES");
  // Mesh exporters should emit faces; this catches accidental routing to a non-mesh DXF.
  expect(dxfText).toContain("3DFACE");

}, { timeout: 60000 });

test("obj → schem", async () => {

  const objFormat: FileFormat = {
    name: "Wavefront OBJ",
    format: "obj",
    extension: "obj",
    mime: "model/obj",
    from: true,
    to: false,
    internal: "obj",
    category: "model",
  };

  const schemFormat: FileFormat = {
    name: "Sponge Schematic",
    format: "schem",
    extension: "schem",
    mime: "application/x-minecraft-schem",
    from: false,
    to: true,
    internal: "schem",
    category: ["model", "minecraft"],
  };

  const conversion = await attemptConversion(
    ["cube.obj"],
    objFormat,
    schemFormat
  );

  expect(conversion).toBeTruthy();
  expect(conversion?.files.length).toBe(1);

  const bytes = Uint8Array.from(Object.values(conversion!.files[0].bytes) as number[]);
  // Sponge schem is typically gzipped NBT.
  expect(bytes[0]).toBe(0x1f);
  expect(bytes[1]).toBe(0x8b);

}, { timeout: 180000 });

test("obj → voxel json", async () => {

  const objFormat: FileFormat = {
    name: "Wavefront OBJ",
    format: "obj",
    extension: "obj",
    mime: "model/obj",
    from: true,
    to: false,
    internal: "obj",
    category: "model",
  };

  const voxelJsonFormat: FileFormat = {
    name: "Voxel Grid JSON (Sparse)",
    format: "voxels",
    extension: "json",
    mime: "application/vnd.voxel+json",
    from: false,
    to: true,
    internal: "voxels",
    category: ["model", "voxel"],
  };

  const conversion = await attemptConversion(
    ["cube.obj"],
    objFormat,
    voxelJsonFormat
  );

  expect(conversion).toBeTruthy();
  expect(conversion?.files.length).toBe(1);

  const bytes = Uint8Array.from(Object.values(conversion!.files[0].bytes) as number[]);
  const text = new TextDecoder().decode(bytes);
  const json = JSON.parse(text);
  expect(json).toBeTruthy();
  expect(json.size?.x).toBeGreaterThan(0);
  expect(Array.isArray(json.voxels)).toBe(true);

}, { timeout: 180000 });

// ==================================================================
//                          END OF TESTS
// ==================================================================


afterAll(async () => {
  await browser.close();
  server.stop();
});
