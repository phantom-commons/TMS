import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type * as THREE from 'three';
import { assetPathFor } from './asset-manifest';

const cache = new Map<string, Promise<THREE.Group>>();
const backgroundCache = new Map<string, Promise<THREE.Texture>>();

const HDR_PATH = 'assets/hdris/kloofendal_48d_partly_cloudy_puresky_2k.hdr';

/**
 * Fondo HDR por hash (la textura se cachea por hash).
 */
export function loadBackground(hash: string): Promise<THREE.Texture> {
  const key = hash.toLowerCase();
  const hit = backgroundCache.get(key);
  if (hit) return hit;
  const promise = (async (): Promise<THREE.Texture> => {
    const res = await fetch(`${import.meta.env.BASE_URL}${HDR_PATH}`);
    if (!res.ok) throw new Error(`asset fetch falló: ${HDR_PATH} (${res.status})`);
    const loader = new HDRLoader();
    return await loader.loadAsync(`${import.meta.env.BASE_URL}${HDR_PATH}`);
  })();
  backgroundCache.set(key, promise);
  return promise;
}

/**
 * Carga (y cachea) el modelo 3D de un asset por su hash SHA-256. La primera vez
 * hace fetch al archivo GLB público y parsea con GLTFLoader; las siguientes
 * reutilizan la promesa resuelta.
 */
export function loadAsset(hash: string): Promise<THREE.Group> {
  const key = hash.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const entry = assetPathFor(key);
  const promise = (async (): Promise<THREE.Group> => {
    if (!entry) throw new Error(`asset no encontrado en el store: ${key}`);
    const res = await fetch(`${import.meta.env.BASE_URL}${entry.path}`);
    if (!res.ok) throw new Error(`asset fetch falló: ${entry.path} (${res.status})`);
    const buffer = await res.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await new Promise<THREE.Group>((resolve, reject) => {
      loader.parse(buffer, '', (result) => resolve(result.scene), (err) => reject(err));
    });
    return gltf;
  })();
  cache.set(key, promise);
  return promise;
}
