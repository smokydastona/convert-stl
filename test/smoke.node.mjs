import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeBase(base) {
  const raw = (base ?? "/convert/").trim() || "/convert/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

const basePath = normalizeBase(process.env.VITE_BASE);
const distDir = path.join(__dirname, "..", "dist");
const resourcesDir = path.join(__dirname, "resources");

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function withNoTraversal(p) {
  // normalize + strip leading separators; then reject any parent traversals
  const normalized = path.posix.normalize(p.replace(/\\/g, "/"));
  const stripped = normalized.replace(/^\/+/, "");
  if (stripped.includes("..")) return null;
  return stripped;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".wasm":
      return "application/wasm";
    case ".bin":
      return "application/octet-stream";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
      return "video/mp4";
    case ".dxf":
      return "image/vnd.dxf";
    default:
      return "application/octet-stream";
  }
}

function toBytes(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  // Puppeteer/structured-clone often turns Uint8Array into a plain object.
  if (typeof value === "object") {
    return Uint8Array.from(Object.values(value));
  }
  throw new TypeError(`Unsupported bytes type: ${typeof value}`);
}

async function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const urlPath = url.pathname;

      // Redirect root -> basePath for non-root deployments.
      if (basePath !== "/" && (urlPath === "/" || urlPath === "")) {
        res.statusCode = 302;
        res.setHeader("Location", `${basePath}`);
        res.end();
        return;
      }

      // Serve index for the base path itself.
      if (urlPath === basePath || urlPath === basePath.slice(0, -1)) {
        const indexPath = path.join(distDir, "index.html");
        if (!(await fileExists(indexPath))) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }
        const buf = await fs.readFile(indexPath);
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(buf);
        return;
      }

      // Map /<base>/... -> dist/...
      let relativePath = urlPath;
      if (relativePath.startsWith(basePath)) {
        relativePath = relativePath.slice(basePath.length);
      } else {
        relativePath = relativePath.replace(/^\/+/, "");
      }

      if (!relativePath) relativePath = "index.html";

      // allow fixtures to be fetched from /test/<name>
      if (relativePath.startsWith("test/")) {
        const testRel = withNoTraversal(relativePath.slice("test/".length));
        if (!testRel) {
          res.statusCode = 400;
          res.end("Bad Request");
          return;
        }
        const full = path.join(resourcesDir, testRel);
        if (!(await fileExists(full))) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }
        const buf = await fs.readFile(full);
        res.statusCode = 200;
        res.setHeader("content-type", contentTypeFor(full));
        res.end(buf);
        return;
      }

      const safeRel = withNoTraversal(relativePath);
      if (!safeRel) {
        res.statusCode = 400;
        res.end("Bad Request");
        return;
      }

      const full = path.join(distDir, safeRel);
      if (!(await fileExists(full))) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }

      const buf = await fs.readFile(full);
      res.statusCode = 200;
      res.setHeader("content-type", contentTypeFor(full));
      res.end(buf);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return { server, port: address.port };
}

async function main() {
  // Ensure dist exists to avoid confusing failures.
  const indexPath = path.join(distDir, "index.html");
  assert(await fileExists(indexPath), "dist/index.html not found. Run `npm run build` first.");

  const { server, port } = await startServer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    page.on("console", (msg) => {
      // Useful for diagnosing boot failures.
      // eslint-disable-next-line no-console
      console.log(`[browser:${msg.type()}] ${msg.text()}`);
    });

    await page.goto(`http://localhost:${port}${basePath}index.html`, { waitUntil: "domcontentloaded" });

    // Deterministic readiness signal: these globals must exist for conversions.
    await page.waitForFunction(
      () => typeof window.tryConvertByTraversing === "function"
        && typeof window.traversionGraph?.getData === "function"
        && window.traversionGraph.getData().nodes.length > 0,
      { timeout: 180000 }
    );

    async function attemptConversion(files, from, to) {
      return page.evaluate(async (testFileNames, from, to) => {
        const files = [];
        for (const fileName of testFileNames) {
          const bytes = await fetch("/test/" + fileName).then((r) => r.arrayBuffer());
          files.push({ bytes: new Uint8Array(bytes), name: fileName });
        }
        return await window.tryConvertByTraversing(files, { format: from, handler: { name: "dummy" } }, { format: to, handler: { name: "dummy" } });
      }, files, from, to);
    }

    // Minimal smoke checks for recent additions.
    {
      const conv = await attemptConversion(
        ["simple_triangle.dxf"],
        { mime: "image/vnd.dxf", format: "dxf" },
        { mime: "image/svg+xml", format: "svg" }
      );
      assert(conv, "Expected DXF→SVG conversion path");
      const outBytes = toBytes(conv.files[0].bytes);
      const svgText = new TextDecoder().decode(outBytes);
      assert(svgText.includes("<svg"), "Expected SVG output to include <svg>");
    }

    {
      const conv = await attemptConversion(
        ["colors_50x50.png"],
        { mime: "image/png", format: "png" },
        { mime: "image/vnd.dxf", format: "dxf" }
      );
      assert(conv, "Expected PNG→DXF conversion path");
      const outBytes = toBytes(conv.files[0].bytes);
      const dxfText = new TextDecoder().decode(outBytes);
      assert(dxfText.includes("SECTION") && dxfText.includes("ENTITIES"), "Expected DXF structure markers");
      assert(dxfText.includes("3DFACE"), "Expected mesh DXF (3DFACE) output");
    }

    {
      const conv = await attemptConversion(
        ["cube.obj"],
        { mime: "model/obj", format: "obj" },
        { mime: "application/x-minecraft-schem", format: "schem" }
      );
      assert(conv, "Expected OBJ→SCHEM conversion path");
      const outBytes = toBytes(conv.files[0].bytes);
      // Sponge schem is typically gzipped NBT.
      assert(outBytes.length > 2 && outBytes[0] === 0x1f && outBytes[1] === 0x8b, "Expected gzipped .schem output");
    }

    {
      const conv = await attemptConversion(
        ["cube.obj"],
        { mime: "model/obj", format: "obj" },
        { mime: "application/vnd.voxel+json", format: "voxels" }
      );
      assert(conv, "Expected OBJ→Voxel JSON conversion path");
      const outBytes = toBytes(conv.files[0].bytes);
      const text = new TextDecoder().decode(outBytes);
      const json = JSON.parse(text);
      assert(json && typeof json === "object", "Expected JSON object");
      assert(json.size && typeof json.size.x === "number", "Expected size in JSON");
      assert(Array.isArray(json.voxels), "Expected voxels array");
    }

    // eslint-disable-next-line no-console
    console.log("Smoke tests passed.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await main();
