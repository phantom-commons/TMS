import { ZERO, type InputSource, type Vec } from './controller';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];
const ALL = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN]);

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function createKeyboard(): InputSource {
  const held = new Set<string>();

  const down = (e: KeyboardEvent) => {
    if (isTyping(e.target) || !ALL.has(e.code)) return;
    e.preventDefault();
    held.add(e.code);
  };
  const up = (e: KeyboardEvent) => held.delete(e.code);
  const clear = () => held.clear();

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', clear);

  const any = (codes: string[]) => codes.some((c) => held.has(c));

  return {
    read(): Vec {
      const dx = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0);
      const dy = (any(DOWN) ? 1 : 0) - (any(UP) ? 1 : 0);
      return dx === 0 && dy === 0 ? ZERO : { dx, dy };
    },
    dispose() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    },
  };
}