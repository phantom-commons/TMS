import * as THREE from 'three';

export type WorldInteractionHandlers = {
  onEntityClick: (targetId: string) => void;
  onEntityPickup: (entityId: string) => boolean;
  onEntityDrop: (entityId: string, x: number, y: number) => void;
  onCellClick: (x: number, y: number) => void;
  onHover?: (id: string | null) => void;
  onDragPreview?: (cell: { x: number; y: number } | null) => void;
  onInteractionLock?: (locked: boolean) => void;
  /** ¿arrastrar sobre el mundo mueve la cámara ahora? (1ª/3ª persona) */
  canLook?: () => boolean;
  /** movimiento del arrastre en píxeles desde el último aviso (el primero lleva todo lo recorrido) */
  onLook?: (dx: number, dy: number) => void;
  onLookEnd?: () => void;
};

type PointerStart = {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  targetId: string | null;
  entityId: string | null;
  pickedUp: boolean;
  moved: boolean;
  looking: boolean;
  pointerId: number;
};

const CLICK_DISTANCE = 8;
const PICKUP_HOLD_MS = 450;

/**
 * Short click inspects; holding an object picks it up; moving after pickup
 * previews a cell and releasing drops it. Player meshes are inspect-only.
 */
export function attachWorldInteractions(
  canvas: HTMLCanvasElement,
  getCamera: () => THREE.Camera,
  getTargetMeshes: () => ReadonlyMap<string, THREE.Object3D>,
  handlers: WorldInteractionHandlers,
): () => void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let down: PointerStart | null = null;
  let holdTimer = 0;

  const setRay = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, getCamera());
  };

  const cellAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    setRay(clientX, clientY);
    if (!raycaster.ray.intersectPlane(ground, hit)) return null;
    return { x: Math.floor(hit.x), y: Math.floor(hit.z) };
  };

  const clearHoldTimer = () => {
    if (holdTimer) window.clearTimeout(holdTimer);
    holdTimer = 0;
  };

  const clearPreview = () => handlers.onDragPreview?.(null);

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    clearHoldTimer();
    setRay(event.clientX, event.clientY);
    const objects = [...getTargetMeshes().values()];
    const picked = raycaster.intersectObjects(objects, true)[0]?.object as THREE.Object3D | undefined;
    const entityId = typeof picked?.userData.entityId === 'string' ? picked.userData.entityId : null;
    const playerId = typeof picked?.userData.targetId === 'string' ? picked.userData.targetId : null;
    const targetId = entityId ?? playerId;

    down = {
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      targetId,
      entityId,
      pickedUp: false,
      moved: false,
      looking: false,
      pointerId: event.pointerId,
    };

    if (entityId) {
      holdTimer = window.setTimeout(() => {
        if (!down || down.pointerId !== event.pointerId || down.moved) return;
        handlers.onInteractionLock?.(true);
        down.pickedUp = handlers.onEntityPickup(entityId);
        if (!down.pickedUp) handlers.onInteractionLock?.(false);
        if (down.pickedUp) {
          const cell = cellAt(down.lastX, down.lastY);
          handlers.onDragPreview?.(cell);
        }
      }, PICKUP_HOLD_MS);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!down || down.pointerId !== event.pointerId) return;
    const prevX = down.lastX;
    const prevY = down.lastY;
    down.lastX = event.clientX;
    down.lastY = event.clientY;
    const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (distance >= CLICK_DISTANCE) {
      down.moved = true;
      if (!down.pickedUp) clearHoldTimer();
    }
    if (down.pickedUp) {
      handlers.onDragPreview?.(cellAt(event.clientX, event.clientY));
      return;
    }
    // arrastrar sin haber recogido nada = mirar (solo si la cámara gira)
    if (down.moved && handlers.canLook?.()) {
      if (!down.looking) {
        down.looking = true;
        handlers.onLook?.(event.clientX - down.x, event.clientY - down.y);
      } else {
        handlers.onLook?.(event.clientX - prevX, event.clientY - prevY);
      }
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!down || down.pointerId !== event.pointerId || event.button !== 0) return;
    const start = down;
    down = null;
    clearHoldTimer();
    if (start.looking) {
      handlers.onLookEnd?.();
      clearPreview();
      return;
    }

    if (start.pickedUp && start.entityId) {
      handlers.onInteractionLock?.(false);
      clearPreview();
      // Holding without dragging picks the object up into inventory.
      if (!start.moved) return;
      const cell = cellAt(event.clientX, event.clientY);
      if (cell) handlers.onEntityDrop(start.entityId, cell.x, cell.y);
      return;
    }

    clearPreview();
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance >= CLICK_DISTANCE) return;
    if (start.targetId) {
      handlers.onEntityClick(start.targetId);
      return;
    }
    const cell = cellAt(event.clientX, event.clientY);
    if (cell) handlers.onCellClick(cell.x, cell.y);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (down && down.pointerId === event.pointerId) {
      if (down.pickedUp) handlers.onInteractionLock?.(false);
      if (down.looking) handlers.onLookEnd?.();
      down = null;
    }
    clearHoldTimer();
    clearPreview();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  return () => {
    clearHoldTimer();
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    clearPreview();
  };
}
