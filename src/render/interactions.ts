import * as THREE from 'three';

export type WorldInteractionHandlers = {
  onEntityClick: (entityId: string) => void;
  onEntityDrop: (entityId: string, x: number, y: number) => void;
  onCellClick: (x: number, y: number) => void;
};

export function attachWorldInteractions(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera | (() => THREE.Camera),
  getEntityMeshes: () => ReadonlyMap<string, THREE.Mesh>,
  handlers: WorldInteractionHandlers,
): () => void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let down: { x: number; y: number; entityId: string | null } | null = null;

  const setRay = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, typeof camera === 'function' ? camera() : camera);
  };

  const cellAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    setRay(clientX, clientY);
    if (!raycaster.ray.intersectPlane(ground, hit)) return null;
    return { x: Math.floor(hit.x), y: Math.floor(hit.z) };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    setRay(event.clientX, event.clientY);
    const meshes = [...getEntityMeshes().values()];
    const picked = raycaster.intersectObjects(meshes, false)[0]?.object as THREE.Mesh | undefined;
    down = {
      x: event.clientX,
      y: event.clientY,
      entityId: typeof picked?.userData.targetId === 'string'
        ? picked.userData.targetId
        : typeof picked?.userData.entityId === 'string' ? picked.userData.entityId : null,
    };
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!down || event.button !== 0) return;
    const start = down;
    down = null;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (start.entityId) {
      if (distance >= 8) {
        const cell = cellAt(event.clientX, event.clientY);
        if (cell) handlers.onEntityDrop(start.entityId, cell.x, cell.y);
      } else {
        handlers.onEntityClick(start.entityId);
      }
      return;
    }
    if (distance < 8) {
      const cell = cellAt(event.clientX, event.clientY);
      if (cell) handlers.onCellClick(cell.x, cell.y);
    }
  };

  const onPointerCancel = () => { down = null; };
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };
}
