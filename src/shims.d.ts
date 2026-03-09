declare module "voxelizer" {
  import type * as THREE from "three";

  type SamplerOptions = {
    fill?: boolean;
    color?: boolean;
  };

  class Sampler {
    constructor(algorithm: string, options?: SamplerOptions);
    sample(object: THREE.Object3D, resolution: number): unknown;
  }

  class ArrayExporter {
    parse(volume: unknown, cb: (result: any[]) => void): void;
  }

  const voxelizer: {
    Sampler: typeof Sampler;
    ArrayExporter: typeof ArrayExporter;
  };

  export default voxelizer;
}
