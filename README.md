# Convert (fork: convert-stl)

A “runs-locally-in-your-browser” file converter built on Vite + TypeScript.
No uploads: files are processed on your machine in the browser UI (or packaged as a desktop app).

This repository is a fork of the upstream project:

- Upstream: https://github.com/p2r3/convert

The goal of this fork is to add more conversions (especially 3D/voxel tooling) and keep them regression-tested.

## Live site

This fork can be published with GitHub Pages (via GitHub Actions). Once enabled, the URL will be:

https://smokydastona.github.io/convert-stl/

## Usage

1. Open the site (GitHub Pages) or run locally.
2. Drag a file into the page.
3. Pick an output format.
4. Click **Convert**.

Tip: if you don’t see a format, try searching by extension or MIME.

### Troubleshooting: “NotReadableError” when converting

If you see an error like `NotReadableError: The requested file could not be read`, the converter usually didn’t even reach the conversion step — the browser couldn’t read the file.

Common causes:

- Cloud/placeholder files (OneDrive/Dropbox/Google Drive) that are not fully downloaded
- Another app locking the file
- OS/browser permission restrictions

Fixes:

- Copy the file to a local folder (e.g. Desktop) and re-select it
- If it’s in OneDrive/Dropbox, mark it “available offline” / ensure it’s fully downloaded
- Close any app that might have the file open

## Differences vs upstream (comprehensive)

This section documents what is different in this fork compared to `p2r3/convert`.

If you need a *guaranteed exhaustive* accounting, scroll down to **Exhaustive diff (regenerate anytime)**.

### New/expanded conversions (handlers)

This fork adds or significantly expands the following conversion handlers:

- **DXF support**
  - Adds DXF handling routes and tests (examples covered: DXF→SVG and PNG→DXF).
- **3D pipeline expansions (Three.js + custom mesh tooling)**
  - Adds mesh import/cleanup/export utilities and additional 3D conversion routes.
  - Adds “pixel-art height” / heightfield-based mesh workflows.
- **Voxel + Minecraft-ish tooling**
  - Adds mesh voxelization and Minecraft-focused exporters.
  - Adds sparse voxel grid JSON export and import (`application/vnd.voxel+json`).
- **Blockbench JSON import**
  - Blockbench `.json` is now importable (and covered by smoke conversion to GLB).
- **More archive/media/document formats**
  - Adds libarchive-based archive format support (e.g. 7z/rar paths where supported by the WASM build).
  - Adds PSD and additional PDF-related conversion wiring.
  - Adds subtitle conversions.

Some existing handlers are also modified (e.g., FFmpeg/ImageMagick wiring tweaks, format normalization improvements).

### Graph/pathfinding + UI guardrails

Upstream already uses a graph/pathfinder for conversion routes; this fork extends guardrails so users don’t land in “dead-end” format situations:

- **Reachability enforcement**: prefers/selects only formats that are actually reachable.
- **No export-only outputs in the UI**: output formats are filtered so a format is only offered as an output if it is importable somewhere in the app.

### Startup performance + cache handling

- Includes a default `public/cache.json` so the app doesn’t request a missing cache file.
- Keeps `buildCache.js` and cache workflows aligned with CI/browser-based enumeration.

### Tests

This fork adds/expands tests beyond upstream:

- **Node + Puppeteer smoke tests** (`test/smoke.node.mjs`)
  - Executes conversions in the built app via the same UI/runtime code paths.
  - Fails the run on browser `console.error` and `pageerror` to prevent silent runtime regressions.
  - Includes a guard ensuring the UI’s output list doesn’t contain non-importable formats.
- Adds additional fixtures used by tests (OBJ/DXF/Blockbench JSON examples, etc.).

### Developer tooling + project structure

- Adds/uses Bun configuration (`bunfig.toml`) and scopes Bun test discovery.
- Adds a Node-focused TypeScript config (`tsconfig.node.json`) and shims (`src/shims.d.ts`) to keep browser + tooling builds happy.
- Adds CLI/scripts for local workflows (e.g. STL→SCHEM script and block generation utilities).

### CI / deployment

- Updates GitHub Actions workflows (Pages, Electron, Docker) to work reliably for this fork.
- Improves Puppeteer/Chrome installation behavior in CI (especially for Electron packaging).
- Pins Bun and includes a Windows fallback installer to reduce flaky CI failures when GitHub release assets temporarily return 5xx.
- Keeps `VITE_BASE` handling correct for GitHub Pages deployment.

### Releases

Forks can be tagged and released normally.

- Create a tag: `git tag -a <tag-name> -m <tag-name>`
- Push it: `git push origin <tag-name>`
- Publish on GitHub: Repo → Releases → “Draft a new release” → choose the tag

This fork has a tag named `3d-dark-mode-converter`.

## Run locally

> Important: clone with submodules (some handlers are vendored).

### Install

Pick one:

- Bun (recommended for full parity with CI):
  - `bun install`
- Node:
  - `npm install`

### Dev server

- `npm run dev` (or `bunx vite`)

### Build + preview

- `npm run build`
- `npm run preview`

## Startup cache (optional)

On first load, the app may spend time discovering each handler’s supported formats.

- This repo includes a default `public/cache.json` so the app doesn’t request a missing file.
- To generate a populated cache:
  1. Run a build: `bun run build`
  2. Ensure a Chrome binary is available for Puppeteer (CI does this automatically)
  3. Run: `bun run cache:build`

`cache:build` writes `dist/cache.json`. If you want that cache to ship by default, copy its contents into `public/cache.json`.

## Tests

- Fast local smoke (Node + Puppeteer): `npm run test:node`
- Full suite (Bun): `bun test`

## Deploy

### GitHub Pages

The Pages workflow sets `VITE_BASE=/<repo-name>/` so assets resolve correctly.

### Docker

Compose file(s) live in the `docker/` directory.

- Start (prebuilt image):
  - `docker compose -f docker/docker-compose.yml up -d`

This serves the app at `http://localhost:8080/convert/`.

### Desktop (Electron)

- Build + run: `bun run desktop:start`
- Create installers:
  - Windows: `bun run desktop:dist:win`
  - macOS: `bun run desktop:dist:mac`
  - Linux: `bun run desktop:dist:linux`

## Exhaustive diff (regenerate anytime)

The lists below are generated from git by comparing this fork’s `HEAD` against `upstream/master`.

At the time of writing:

- `HEAD`: `da7c0970ce5ad23d75fd1180d384834452de6b7c`
- merge-base with `upstream/master`: `f096954d36816b16d36558bb571c0a3fc4eb6172`

To regenerate locally:

```bash
git fetch upstream
BASE=$(git merge-base HEAD upstream/master)
git log --oneline "$BASE..HEAD"
git diff --name-status "$BASE..HEAD"
git diff --stat "$BASE..HEAD"
```

### Changed files (name-status)

```text
M       .github/workflows/docker.yml
M       .github/workflows/electron.yml
M       .github/workflows/pages.yml
M       .gitignore
M       README.md
M       buildCache.js
A       bunfig.toml
M       docker/Dockerfile
M       index.html
M       package.json
A       scripts/generateVanillaBlocks.ts
A       scripts/stl2schem.ts
M       src/CommonFormats.ts
A       src/convert/three_d/dxf.ts
A       src/convert/three_d/exporters.ts
A       src/convert/three_d/index.ts
A       src/convert/three_d/meshBuilder.ts
A       src/convert/three_d/meshCleanup.ts
A       src/convert/three_d/minecraft.ts
A       src/convert/three_d/pixelArtHeight.ts
A       src/convert/three_d/stlImport.ts
M       src/handlers/FFmpeg.ts
M       src/handlers/ImageMagick.ts
A       src/handlers/adobePdf.ts
A       src/handlers/dxf.ts
M       src/handlers/flo.ts
M       src/handlers/flo.worker.ts
A       src/handlers/imageToMesh.ts
A       src/handlers/img2mesh.ts
M       src/handlers/index.ts
A       src/handlers/libarchive.ts
M       src/handlers/libopenmpt.ts
A       src/handlers/meshVox.ts
M       src/handlers/midi.ts
A       src/handlers/obj2voxel.ts
M       src/handlers/pandoc/pandoc.js
A       src/handlers/pixelArt3d.ts
A       src/handlers/psd.ts
A       src/handlers/subtitles.ts
M       src/handlers/texttoshell.ts
M       src/handlers/threejs.ts
M       src/handlers/txtToInfiniteCraft.ts
M       src/main.ts
M       src/normalizeMimeType.ts
A       src/shims.d.ts
M       style.css
M       test/commonFormats.test.ts
A       test/pixelArtHeight.test.ts
A       test/resources/blockbench_simple.json
A       test/resources/cube.obj
A       test/resources/simple_triangle.dxf
A       test/smoke.node.mjs
M       tsconfig.json
A       tsconfig.node.json
M       vite.config.js
```

## License

GPL-2.0 (see LICENSE).
