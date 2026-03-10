import { describe, expect, it } from "bun:test";
import * as THREE from "three";

import { pixelArtHeightMeshFromRgba } from "../src/convert/three_d/pixelArtHeight";

describe("pixelArtHeightMeshFromRgba", () => {
  it("creates prisms with height based on unique color rank", () => {
    // 2x2 image, scan order:
    // (0,0)=red, (1,0)=red, (0,1)=blue, (1,1)=transparent
    // Unique colors: red(idx0), blue(idx1)
    // Heights: red=1, blue=1-1/2=0.5
    const width = 2;
    const height = 2;
    const rgba = new Uint8Array([
      255, 0, 0, 255,   255, 0, 0, 255,
      0, 0, 255, 255,   0, 0, 0, 0,
    ]);

    const mesh = pixelArtHeightMeshFromRgba(width, height, rgba, { pixelSize: 1, heightScale: 1, minHeight: 0.01 });
    expect(mesh).toBeInstanceOf(THREE.Mesh);

    mesh.geometry.computeBoundingBox();
    const bbox = mesh.geometry.boundingBox;
    expect(bbox).toBeTruthy();
    if (!bbox) return;

    // Z should go from 0 to ~1 (max height).
    expect(bbox.min.z).toBeCloseTo(0, 6);
    expect(bbox.max.z).toBeCloseTo(1, 6);

    // X/Y extents should match 2 pixels * 1 unit.
    expect(bbox.max.x - bbox.min.x).toBeCloseTo(2, 6);
    expect(bbox.max.y - bbox.min.y).toBeCloseTo(2, 6);
  });
});
