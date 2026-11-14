import * as THREE from 'three';

export type WorldInteractionHandlers = {
  onEntityClick: (entityId: string) => void;
  onEntityDrop: (entityId: string, x: number, y: number) => void;
  onCellClick: (x: number, y: number) => void;
  /** objeto/jugador bajo el cursor (null si ninguno) */
  onHover?: (entityId: string | null) => void;
};

export function attachWorldInteractions(
  canvas: HTMLCanvasElement,
  getCamera: () => THREE.Camera,
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
    // con el puntero bloqueado (primera persona) se apunta al centro de la pantalla
    if (document.pointerLockElement === canvas) ndc.set(0, 0);
    else ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, getCamera());
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

  let hovered: string | null = null;
  const onPointerMove = (event: PointerEvent) => {
    if (!handlers.onHover || event.pointerType === 'touch') return;
    setRay(event.clientX, event.clientY);
    const picked = raycaster.intersectObjects([...getEntityMeshes().values()], false)[0]?.object as THREE.Mesh | undefined;
    const id = typeof picked?.userData.targetId === 'string'
      ? picked.userData.targetId
      : typeof picked?.userData.entityId === 'string' ? picked.userData.entityId : null;
    if (id !== hovered) {
      hovered = id;
      canvas.style.cursor = id ? 'pointer' : '';
      handlers.onHover(id);
    }
  };

  const onPointerCancel = () => { down = null; };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };
}
