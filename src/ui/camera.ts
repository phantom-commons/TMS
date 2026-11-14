import type { CameraMode, CameraRig } from '../render/scene';

const OPTIONS: Array<{ value: CameraMode; label: string }> = [
  { value: 'isometric', label: 'Isométrica' },
  { value: 'top', label: 'Superior' },
  { value: 'perspective', label: 'Perspectiva' },
];

export function attachCameraControls(cameraRig: CameraRig): void {
  document.getElementById('camera-hud')?.remove();
  const root = document.createElement('label');
  root.id = 'camera-hud';
  root.className = 'camera-hud';

  const icon = document.createElement('span');
  icon.textContent = '◉';
  icon.setAttribute('aria-hidden', 'true');

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Cambiar cámara');
  for (const option of OPTIONS) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    select.append(item);
  }
  select.value = cameraRig.getMode();
  select.addEventListener('change', () => cameraRig.setMode(select.value as CameraMode));

  root.append(icon, select);
  document.body.append(root);
}
