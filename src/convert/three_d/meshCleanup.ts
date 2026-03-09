import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export type CleanupOptions = {
  mergeTolerance?: number;
  center?: boolean;
  /** If true, translate mesh so its min Z becomes 0. */
  zToFloor?: boolean;
  /** If true, rotate so the longest axis lies along +X (best-effort). */
  normalizeOrientation?: boolean;
};

function removeDegenerateTriangles(geometry: THREE.BufferGeometry, eps = 1e-12): THREE.BufferGeometry {
  const geom = geometry.index ? geometry.clone() : geometry.toNonIndexed();
  const pos = geom.getAttribute("position");
  if (!pos) return geom;

  const triCount = pos.count / 3;
  const out: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    a.fromBufferAttribute(pos, i * 3 + 0);
    b.fromBufferAttribute(pos, i * 3 + 1);
    c.fromBufferAttribute(pos, i * 3 + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    cross.crossVectors(ab, ac);
    if (cross.lengthSq() <= eps) continue;
    out.push(
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      c.x, c.y, c.z
    );
  }

  const cleaned = new THREE.BufferGeometry();
  cleaned.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  return cleaned;
}

function bestEffortNormalizeOrientation(object: THREE.Object3D) {
  const bbox = new THREE.Box3().setFromObject(object);
  const size = bbox.getSize(new THREE.Vector3());
  // Rotate so the longest axis becomes X.
  if (size.y >= size.x && size.y >= size.z) {
    object.rotateZ(-Math.PI / 2);
  } else if (size.z >= size.x && size.z >= size.y) {
    object.rotateY(Math.PI / 2);
  }
}

export function cleanGeometry(input: THREE.BufferGeometry, options: CleanupOptions = {}): THREE.BufferGeometry {
  const mergeTolerance = options.mergeTolerance ?? 1e-4;

  let geom = input.clone();
  geom = removeDegenerateTriangles(geom);
  geom = mergeVertices(geom, mergeTolerance);
  geom.computeVertexNormals();
  geom.computeBoundingBox();

  if (options.center) geom.center();

  if (options.zToFloor) {
    const bbox = geom.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geom.getAttribute("position") as any);
    geom.translate(0, 0, -bbox.min.z);
  }

  return geom;
}

export function cleanMesh(input: THREE.Mesh, options: CleanupOptions = {}): THREE.Mesh {
  const mesh = input.clone();
  mesh.geometry = cleanGeometry(mesh.geometry, options);

  if (options.normalizeOrientation) {
    bestEffortNormalizeOrientation(mesh);
    mesh.updateMatrixWorld(true);
  }

  return mesh;
}
