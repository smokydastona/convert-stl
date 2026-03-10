import puppeteer from "puppeteer";

const url = process.env.SMOKE_URL || process.argv[2] || "https://smokydastona.github.io/convert-stl/index.html";

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const page = await browser.newPage();

const browserErrors = [];
const httpErrors = [];
const requestFails = [];

page.on("console", (msg) => {
  const text = `[browser:${msg.type()}] ${msg.text()}`;
  // Keep stdout readable but still capture errors.
  if (msg.type() === "error") {
    console.error(text);
    browserErrors.push(msg.text());
  } else {
    console.log(text);
  }
});

page.on("pageerror", (err) => {
  const text = String(err?.stack || err);
  console.error("[browser:pageerror]", text);
  browserErrors.push(text);
});

page.on("requestfailed", (req) => {
  requestFails.push(`${req.url()} :: ${req.failure()?.errorText || "request failed"}`);
});

page.on("response", (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.status()} ${res.url()}`);
});

await page.goto(url, { waitUntil: "domcontentloaded" });

await page.waitForFunction(
  () =>
    typeof window.tryConvertByTraversing === "function" &&
    typeof window.traversionGraph?.getData === "function" &&
    window.traversionGraph.getData().nodes.length > 0,
  { timeout: 180_000 }
);

const snapshot = await page.evaluate(() => {
  const graph = window.traversionGraph?.getData?.();
  return {
    locationHref: globalThis.location.href,
    convertBase: globalThis.__CONVERT_BASE__ ?? null,
    cacheSize: window.supportedFormatCache?.size ?? 0,
    nodeCount: graph?.nodes?.length ?? null,
    edgeCount: graph?.edges?.length ?? null,
  };
});

console.log("SNAPSHOT", JSON.stringify(snapshot));

const txtShProbe = await page.evaluate(() => {
  const all = Array.from(window.supportedFormatCache?.values?.() ?? []);
  const txt = all.filter((f) => f.internal === "txt" || f.format === "txt" || f.extension === "txt");
  const sh = all.filter((f) => f.internal === "sh" || f.format === "sh" || f.extension === "sh");
  return {
    txt: txt.slice(0, 3),
    sh: sh.slice(0, 3),
  };
});
console.log("TXT_SH_PROBE", JSON.stringify(txtShProbe));

async function tryConvert(name, bytes, from, to) {
  // Kept for binary tests later if needed.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return await page.evaluate(async (name, buffer, from, to) => {
    const u8 = new Uint8Array(buffer);
    const files = [{ name, bytes: u8 }];

    return await window.tryConvertByTraversing(
      files,
      { format: from, handler: { name: "dummy" } },
      { format: to, handler: { name: "dummy" } }
    );
  }, name, buffer, from, to);
}

async function tryConvertText(name, text, from, to) {
  return await page.evaluate(async (name, text, from, to) => {
    const u8 = new TextEncoder().encode(text);
    const files = [{ name, bytes: u8 }];

    return await window.tryConvertByTraversing(
      files,
      { format: from, handler: { name: "dummy" } },
      { format: to, handler: { name: "dummy" } }
    );
  }, name, text, from, to);
}

function textBytes(s) {
  return new TextEncoder().encode(s);
}

// 1) trivial TXT -> SH should be pure JS
{
  const conv = await page.evaluate(async () => {
    const all = Array.from(window.supportedFormatCache?.values?.() ?? []);
    const from = all.find((f) => f.internal === "txt" || f.format === "txt" || f.extension === "txt");
    const to = all.find((f) => f.internal === "sh" || f.format === "sh" || f.extension === "sh");
    if (!from || !to) return null;
    const u8 = new TextEncoder().encode("hello world");
    const files = [{ name: "a.txt", bytes: u8 }];
    return await window.tryConvertByTraversing(
      files,
      { format: from, handler: { name: "dummy" } },
      { format: to, handler: { name: "dummy" } }
    );
  });
  console.log("TXT->SH", conv ? "OK" : "NULL");
}

// 2) Blockbench JSON -> GLB
{
  const bb = JSON.stringify({
    format_version: "4.0",
    name: "simple",
    elements: [{ name: "cube", from: [0, 0, 0], to: [16, 16, 16] }],
  });
  const conv = await tryConvertText(
    "model.json",
    bb,
    { mime: "application/json", format: "blockbench" },
    { mime: "model/gltf-binary", format: "glb" }
  );
  console.log("BB->GLB", conv ? "OK" : "NULL");
}

console.log("BROWSER_ERRORS", browserErrors.length);
if (browserErrors.length) console.log(browserErrors.slice(0, 10));
console.log("HTTP_ERRORS", httpErrors.length);
if (httpErrors.length) console.log(httpErrors.slice(0, 10));
console.log("REQUEST_FAILS", requestFails.length);
if (requestFails.length) console.log(requestFails.slice(0, 10));

await browser.close();

// Make this usable in CI / debugging.
if (browserErrors.length || requestFails.length) process.exit(2);
