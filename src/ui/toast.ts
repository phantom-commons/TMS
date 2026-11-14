let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, ms = 2200): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => el?.classList.remove('show'), ms);
}
