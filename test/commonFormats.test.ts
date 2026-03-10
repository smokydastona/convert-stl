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

test("all remaining formats are mutually reachable", async () => {
  const result = await page.evaluate(() => {
    const data = window.traversionGraph.getData();
    const n = data.nodes.length;
    const adj: number[][] = Array.from({ length: n }, () => []);
    const radj: number[][] = Array.from({ length: n }, () => []);
    for (const e of data.edges) {
      adj[e.from.index].push(e.to.index);
      radj[e.to.index].push(e.from.index);
    }

    function bfs(start: number, graph: number[][]) {
      const seen = new Uint8Array(n);
      const q: number[] = [start];
      seen[start] = 1;
      while (q.length) {
        const v = q.pop()!;
        for (const next of graph[v]) {
          if (!seen[next]) {
            seen[next] = 1;
            q.push(next);
          }
        }
      }
      let count = 0;
      for (let i = 0; i < n; i++) count += seen[i];
      return count;
    }

    if (n === 0) return { ok: true, nodes: 0 };

    const forward = bfs(0, adj);
    const backward = bfs(0, radj);
    return {
      ok: forward === n && backward === n,
      nodes: n,
      forwardReachable: forward,
      backwardReachable: backward,
    };
  });

  expect(result.ok).toBe(true);
}, { timeout: 60000 });

// ==================================================================
//                          END OF TESTS
// ==================================================================


afterAll(async () => {
  await browser.close();
  server.stop();
});
