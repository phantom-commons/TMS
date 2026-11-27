export type DoorDialog = {
  open: (dest: string) => void;
  close: () => void;
  dispose: () => void;
};

/** Diálogo al tocar/acercarse a una puerta: pide el código de la sala destino. */
export function createDoorDialog(deps: { enter: (roomId: string) => void; onCancel?: () => void }): DoorDialog {
  const overlay = document.createElement('div');
  overlay.id = 'door-overlay';
  overlay.className = 'login-overlay';
  const close = () => overlay.remove();
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  const card = document.createElement('div');
  card.className = 'login-card door';
  overlay.append(card);
  // el overlay se añade al DOM solo en open(): si no, queda una tarjeta vacía (barra gris) tapando la pantalla

  const open = (dest: string) => {
    if (overlay.isConnected) return;
    card.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = '¿A dónde vas?';
    card.append(title);

    const destEl = document.createElement('p');
    destEl.className = 'door-dest';
    destEl.textContent = dest === 'home' ? 'Tu sala' : `Sala ${dest}`;
    card.append(destEl);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'code';
    input.maxLength = 64;
    input.value = dest === 'home' ? '' : dest;
    input.placeholder = 'código de sala';
    card.append(input);

    const err = document.createElement('p');
    err.className = 'error';
    err.textContent = '';
    card.append(err);

    const enter = document.createElement('button');
    enter.type = 'button';
    enter.textContent = 'Entrar';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    cancel.className = 'secondary';
    const row = document.createElement('div');
    row.className = 'door-actions';
    row.append(enter, cancel);
    card.append(input, err, row);

    const proc = document.createElement('button');
    proc.type = 'button';
    proc.className = 'secondary door-wide';
    proc.textContent = 'Mundo procedural';
    proc.addEventListener('click', () => {
      close();
      deps.enter(`room-${Math.random().toString(36).slice(2, 10)}`);
    });
    card.append(proc);

    const atrium = document.createElement('button');
    atrium.type = 'button';
    atrium.className = 'secondary door-wide';
    atrium.textContent = 'Atrium';
    atrium.addEventListener('click', () => {
      close();
      deps.enter('atrium');
    });
    card.append(atrium);

    const submit = () => {
      const roomId = dest === 'home' ? 'home' : input.value.trim() || dest;
      if (!/^[A-Za-z0-9:_-]{1,64}$/.test(roomId)) {
        err.textContent = 'código de sala inválido';
        return;
      }
      close();
      deps.enter(roomId);
    };
    enter.onclick = submit;
    cancel.onclick = () => {
      close();
      // al cancelar también liberamos el estado para que checkDoor no reabra
      deps.onCancel?.();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    document.body.append(overlay);
  };

  const dispose = () => {
    overlay.remove();
  };

  return { open, close, dispose };
}
