import type * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Exporta un objeto de Three a un .glb binario (en el navegador). Los nombres de los nodos se conservan. */
export async function exportGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  const out = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  return out as ArrayBuffer;
}
