export type Dir = 'up' | 'down' | 'left' | 'right';

export function attachKeyboard(onDir: (d: Dir) => void): () => void {
  const handler = (e: KeyboardEvent) => {
    let d: Dir | null = null;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') d = 'up';
    else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') d = 'down';
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') d = 'left';
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') d = 'right';

    if (d) {
      e.preventDefault();
      onDir(d);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}