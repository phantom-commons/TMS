import * as THREE from 'three';

export function initDoorInteractions(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  scene: THREE.Scene,
  onDoorClicked: (targetRoomId: string) => void
) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const handlePointerDown = (event: PointerEvent) => {
    // Normalizar las coordenadas del mouse/toque a un rango de -1 a 1 para Three.js
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Buscar intersecciones con los objetos de la escena
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const mesh = hit.object as THREE.Mesh;

      // Verificamos si el objeto tocado tiene datos de celda guardados en su userData
      const cellData = mesh.userData?.cell;
      
      if (cellData && cellData.kind === 'door' && cellData.targetRoomId) {
        console.log(`¡Puerta interactuada! Viajando a: ${cellData.targetRoomId}`);
        onDoorClicked(cellData.targetRoomId);
      }
    }
  };

  // Soporta tanto clics de escritorio como toques en celulares
  window.addEventListener('pointerdown', handlePointerDown);

  return () => {
    window.removeEventListener('pointerdown', handlePointerDown);
  };
}