export type ActionName = 'pickdrop' | 'lock' | 'camera' | 'turnL' | 'turnR' | 'dev' | 'radial' | 'escape' | 'attack' | 'chat';

const MAP: Record<string, ActionName> = {
  KeyF: 'pickdrop',
  KeyL: 'lock',
  KeyC: 'camera',
  KeyQ: 'turnL',
  KeyE: 'turnR',
  F2: 'dev',
  KeyR: 'radial',
  KeyG: 'attack',
  Enter: 'chat',
  Escape: 'escape',
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function attachActionKeys(handler: (a: ActionName) => void): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const action = MAP[e.code];
    if (!action) return;
    e.preventDefault();
    handler(action);
  };
  window.addEventListener('keydown', down);
  return () => window.removeEventListener('keydown', down);
}
