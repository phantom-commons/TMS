export type RadialItem = { id: string; icon: string; label: string; run: () => void };

export type Radial = {
  setVisible: (v: boolean) => void;
  toggle: () => void;
  setBadge: (id: string, text: string) => void;
  dispose: () => void;
};

/** Menú radial: un botón fijo abajo a la derecha que despliega sus acciones en arco. */
export function createRadial(items: RadialItem[]): Radial {
  const root = document.createElement('div');
  root.className = 'radial';
  const hub = document.createElement('button');
  hub.type = 'button';
  hub.className = 'radial-hub';
  hub.title = 'Acciones (R)';
  hub.textContent = '✦';
  root.append(hub);

  const badges = new Map<string, HTMLElement>();
  const n = items.length;
  const radius = 104;
  items.forEach((item, i) => {
    // arco de 90° hacia arriba-izquierda (de 180° a 270°)
    const a = Math.PI + (n === 1 ? Math.PI / 4 : (i / (n - 1)) * (Math.PI / 2));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'radial-item';
    b.title = item.label;
    b.style.setProperty('--tx', `${Math.cos(a) * radius}px`);
    b.style.setProperty('--ty', `${Math.sin(a) * radius}px`);
    b.style.transitionDelay = `${i * 25}ms`;
    const icon = document.createElement('span');
    icon.textContent = item.icon;
    const label = document.createElement('small');
    label.textContent = item.label;
    const badge = document.createElement('em');
    badge.hidden = true;
    badges.set(item.id, badge);
    b.append(icon, label, badge);
    b.onclick = () => {
      root.classList.remove('open');
      item.run();
    };
    root.append(b);
  });

  hub.onclick = () => root.classList.toggle('open');
  const outside = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) root.classList.remove('open');
  };
  window.addEventListener('pointerdown', outside);
  document.body.append(root);

  return {
    setVisible: (v) => void (root.hidden = !v),
    toggle: () => void root.classList.toggle('open'),
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
