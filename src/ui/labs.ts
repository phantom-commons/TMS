import { ASSET_INDEX, type AssetEntry } from './asset-manifest';

export type LabsPanel = {
  open: () => void;
  close: () => void;
  destroy: () => void;
};

/** Panel de laboratorio: lista los assets 3D del store y permite colocarlos en la sala. */
export function createLabsPanel(deps: { place: (entry: AssetEntry) => void }): LabsPanel {
  const overlay = document.createElement('div');
  overlay.id = 'labs-overlay';
  overlay.className = 'login-overlay';
  const card = document.createElement('div');
  card.className = 'login-card door';
  overlay.append(card);
  document.body.append(overlay);

  const close = () => overlay.remove();

  const open = () => {
    if (overlay.isConnected) return;
    card.innerHTML = '';
    const title = document.createElement('h1');
    title.textContent = 'Labs 3D';
    card.append(title);
    const list = document.createElement('div');
    list.className = 'labs-list';
    const entries = Object.values(ASSET_INDEX);
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'labs-row';
      const name = document.createElement('span');
      name.textContent = entry.path;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Colocar';
      btn.onclick = () => {
        close();
        deps.place(entry);
      };
      row.append(name, btn);
      list.append(row);
    }
    card.append(list);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Cerrar';
    closeBtn.className = 'secondary';
    closeBtn.onclick = close;
    card.append(closeBtn);
    document.body.append(overlay);
  };
  const destroy = () => {
    overlay.remove();
  };

  return { open, close, destroy };
}
