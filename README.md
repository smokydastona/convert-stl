# Convert (this fork)

A “runs-locally-in-your-browser” file converter built on Vite + TypeScript.
No uploads: files are processed on your machine in the browser UI (or packaged as a desktop app).

This repository is a fork of the upstream project:

- Upstream: https://github.com/p2r3/convert

This fork focuses on shipping more conversions and keeping them regression-tested.

## Highlights

- Hundreds of format routes via a graph/pathfinder (the UI finds a conversion path automatically)
- Extra 3D/voxel conversions:
  - Mesh (OBJ/STL/PLY/GLB) → Sponge schematic (`.schem`)
  - Mesh (OBJ/STL/PLY/GLB) → sparse voxel grid JSON (`application/vnd.voxel+json`)
- DXF conversions (example routes covered by tests: DXF→SVG and PNG→DXF)
- Optional format-cache file to speed up startup

## Use it

1. Open the site (GitHub Pages) or run locally.
2. Drag a file into the page.
3. Pick an output format.
4. Click **Convert**.

Tip: if you don’t see a format, try searching by extension or MIME.

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

## License

GPL-2.0 (see LICENSE).
