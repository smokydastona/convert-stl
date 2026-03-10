import puppeteer from "puppeteer";

function ts() {
  return new Date().toISOString();
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBase(base) {
  const raw = (base ?? "/convert/").trim() || "/convert/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

const minify = process.argv[3] === "--minify";
const basePath = normalizeBase(process.env.VITE_BASE);
const timeoutMs = toInt(process.env.BUILD_CACHE_TIMEOUT_MS, 90_000);
const hardTimeoutMs = toInt(process.env.BUILD_CACHE_HARD_TIMEOUT_MS, Math.max(timeoutMs * 2, 180_000));

const outputPath = process.argv[2] || "cache.json";
// delete previous cache.json so regeneration is forced to happen
const outputFile = Bun.file(outputPath);
if (await outputFile.exists()) {
  await outputFile.delete();
}

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
      const indexFile = Bun.file(`${__dirname}/dist/index.html`);
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

    if (!relativePath) relativePath = "index.html";
    const file = Bun.file(`${__dirname}/dist/${relativePath}`.replaceAll("..", ""));
    if (!(await file.exists())) return new Response("Not Found", { status: 404 });
    return new Response(file);
  },
  port: 8080
});

let browser;
let page;

const pageErrors = [];
const failedRequests = [];
const httpErrors = [];

const hardTimer = setTimeout(() => {
  // If we get here, something is hung hard enough that Puppeteer's own timeouts
  // didn't fire. Force-exit so CI doesn't spin forever.
  console.error(`[${ts()}] cache:build hard timeout after ${hardTimeoutMs}ms`, {
    basePath,
    outputPath,
    timeoutMs,
    hardTimeoutMs,
    pageErrors: pageErrors.slice(0, 50),
    failedRequests: failedRequests.slice(0, 50),
    httpErrors: httpErrors.slice(0, 50),
  });
  try { server.stop(); } catch (_) {}
  // Best-effort exit; no async cleanup here.
  process.exit(1);
}, hardTimeoutMs);

try {
  console.log(`[${ts()}] cache:build starting`, { basePath, outputPath, timeoutMs, hardTimeoutMs, minify });

  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    timeout: timeoutMs,
    protocolTimeout: timeoutMs,
    dumpio: process.env.PUPPETEER_DUMPIO === "1",
  });

  console.log(`[${ts()}] puppeteer launched`);

  page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);

  page.on("pageerror", (err) => {
    pageErrors.push(String(err?.stack || err));
  });
  page.on("console", (msg) => {
    // Keep it compact but useful. Avoid dumping huge objects.
    const text = msg.text();
    console.log(`[${ts()}] [browser:${msg.type()}] ${text}`);
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure();
    failedRequests.push(`${req.url()} :: ${failure?.errorText ?? "request failed"}`);
  });
  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400) {
      httpErrors.push(`${status} ${res.url()}`);
    }
  });

  const targetUrl = `http://localhost:8080${basePath}index.html`;
  console.log(`[${ts()}] navigating`, { targetUrl });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

  console.log(`[${ts()}] waiting for app readiness`);

  // Wait until the app finished building its format list / graph.
  // This ensures cache.json includes ALL handler formats, not just the first few.
  await page.waitForFunction(
    () => typeof window.printSupportedFormatCache === "function"
      && typeof window.traversionGraph?.getData === "function"
      && window.traversionGraph.getData().nodes.length > 0,
    { timeout: timeoutMs }
  );

  console.log(`[${ts()}] generating cache json`);

  const cacheJSON = await page.evaluate((minify) => {
    if (minify === true) {
      return JSON.stringify(JSON.parse(window.printSupportedFormatCache()));
    }
    return window.printSupportedFormatCache();
  }, minify);

  await Bun.write(outputPath, cacheJSON);
  console.log(`[${ts()}] cache:build wrote ${outputPath} (${cacheJSON.length} bytes)`);
} catch (err) {
  let currentUrl;
  try { currentUrl = await page?.url?.(); } catch (_) {}

  console.error(`[${ts()}] cache:build failed`, {
    basePath,
    outputPath,
    timeoutMs,
    hardTimeoutMs,
    url: currentUrl,
    error: String(err?.stack || err),
    pageErrors: pageErrors.slice(0, 50),
    failedRequests: failedRequests.slice(0, 50),
    httpErrors: httpErrors.slice(0, 50),
  });
  throw err;
} finally {
  clearTimeout(hardTimer);
  try { await browser?.close(); } catch (_) {}
  try { server.stop(); } catch (_) {}
}
