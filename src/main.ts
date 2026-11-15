import './style.css';
import { ensureIdentity } from './ui/login';
import { startShell } from './shell/shell';

// Punto de entrada. La identidad se resuelve una vez y después se elige la experiencia:
//   (sin parámetros)   → shell móvil: Inicio · Explorar · Tu Room · Inventario · Perfil (ligero, sin Three.js)
//   ?exp=world         → tu sala 3D (motor original)
//   ?room=<id>         → sala 3D concreta (visitas, atrium…)
// El motor 3D se importa de forma dinámica: quien solo usa el menú o los juegos no descarga Three.js.

const ROOM_PARAM = /^[A-Za-z0-9:_-]{1,64}$/;

async function main() {
  const identity = await ensureIdentity();
  const params = new URLSearchParams(location.search);
  const room = params.get('room')?.trim() ?? '';
  const wantsWorld = params.get('exp') === 'world' || (room !== '' && ROOM_PARAM.test(room));

  if (wantsWorld) {
    const { bootWorld3D } = await import('./experiences/world3d/boot');
    await bootWorld3D(identity);
    return;
  }
  startShell(identity);
}

main().catch((e) => {
  console.error('boot failed:', e);
  document.body.innerHTML = `<pre style="color:#ff6b6b;padding:24px;font-family:monospace">boot failed:\n${e}</pre>`;
});
