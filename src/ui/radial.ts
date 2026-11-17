export type RadialItem = { id: string; icon: string; label: string; run: () => void };

export type Radial = {
  setVisible: (v: boolean) => void;
  toggle: () => void;
  setBadge: (id: string, text: string) => void;
  dispose: () => void;
};

/**
 * Menú de acciones: un botón fijo abajo a la derecha que abre un panel en rejilla.
 * (Antes se desplegaba en arco: con 8 botones de 48 px en un arco de 104 px de radio se solapaban y se pulsaba el equivocado.)
 * Cada acción es un botón grande con su etiqueta a la vista.
 */
export function createRadial(items: RadialItem[]): Radial {
  const root = document.createElement('div');
  root.className = 'radial';
  const hub = document.createElement('button');
  hub.type = 'button';
  hub.className = 'radial-hub';
  hub.title = 'Acciones (R)';
  hub.setAttribute('aria-label', 'Acciones');
  hub.setAttribute('aria-expanded', 'false');
  hub.textContent = '✦';

  const panel = document.createElement('div');
  panel.className = 'radial-panel';
  panel.setAttribute('role', 'menu');
  root.append(panel, hub);

  const badges = new Map<string, HTMLElement>();
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'radial-item';
    b.setAttribute('role', 'menuitem');
    b.title = item.label;
    const icon = document.createElement('span');
    icon.className = 'radial-ico';
    icon.textContent = item.icon;
    const label = document.createElement('small');
    label.textContent = item.label;
    const badge = document.createElement('em');
    badge.hidden = true;
    badges.set(item.id, badge);
    b.append(icon, label, badge);
    b.onclick = () => {
      setOpen(false);
      item.run();
    };
    panel.append(b);
  }

  const setOpen = (open: boolean) => {
    root.classList.toggle('open', open);
    hub.setAttribute('aria-expanded', String(open));
  };
  hub.onclick = () => setOpen(!root.classList.contains('open'));
  const outside = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  };
  window.addEventListener('pointerdown', outside);
  document.body.append(root);

  return {
    setVisible: (v) => void (root.hidden = !v),
    toggle: () => setOpen(!root.classList.contains('open')),
    setBadge(id, text) {
      const el = badges.get(id);
      if (!el) return;
      el.textContent = text;
      el.hidden = text === '';
    },
    dispose() {
      window.removeEventListener('pointerdown', outside);
      root.remove();
    },
  };
}
