import * as THREE from "three";

function formatNum(n: number) {
  // DXF is plain text; keep it reasonably compact.
  // Avoid scientific notation where possible.
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(6);
  return s.replace(/\.0+$/, "").replace(/(\.\d+?)0+$/, "$1");
}

type Tri = [THREE.Vector3, THREE.Vector3, THREE.Vector3];

function getTriangles(geometry: THREE.BufferGeometry): Tri[] {
  const pos = geometry.getAttribute("position");
  if (!pos) return [];

  const tris: Tri[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  const idx = geometry.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const ia = idx.getX(i);
      const ib = idx.getX(i + 1);
      const ic = idx.getX(i + 2);
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      tris.push([a.clone(), b.clone(), c.clone()]);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      tris.push([a.clone(), b.clone(), c.clone()]);
    }
  }

  return tris;
}

export function exportMeshToDxfBytes(mesh: THREE.Mesh, layer: string = "0"): Uint8Array {
  const geom = mesh.geometry.clone();
  geom.applyMatrix4(mesh.matrixWorld);

  const tris = getTriangles(geom);

  const lines: string[] = [];

  // Minimal ASCII DXF
  lines.push("0", "SECTION", "2", "HEADER", "0", "ENDSEC");
  lines.push("0", "SECTION", "2", "TABLES", "0", "ENDSEC");
  lines.push("0", "SECTION", "2", "ENTITIES");

  for (const [p1, p2, p3] of tris) {
    // 3DFACE is widely supported and easy.
    lines.push("0", "3DFACE");
    lines.push("8", layer);

    lines.push("10", formatNum(p1.x));
    lines.push("20", formatNum(p1.y));
    lines.push("30", formatNum(p1.z));

    lines.push("11", formatNum(p2.x));
    lines.push("21", formatNum(p2.y));
    lines.push("31", formatNum(p2.z));

    lines.push("12", formatNum(p3.x));
    lines.push("22", formatNum(p3.y));
    lines.push("32", formatNum(p3.z));

    // 4th vertex duplicates 3rd for triangles
    lines.push("13", formatNum(p3.x));
    lines.push("23", formatNum(p3.y));
    lines.push("33", formatNum(p3.z));
  }

  lines.push("0", "ENDSEC");
  lines.push("0", "EOF");

  const dxf = lines.join("\n") + "\n";
  return new TextEncoder().encode(dxf);
}
