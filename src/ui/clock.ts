/** Reloj de presentación: nunca emite eventos ni modifica el mundo. */
export function attachLocalClock(): () => void {
  const clock = document.createElement('time');
  clock.id = 'local-clock';
  clock.className = 'local-clock';
  clock.dateTime = new Date().toISOString();
  document.body.append(clock);

  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
  const update = () => {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.replaceChildren();
    const time = document.createElement('strong');
    time.textContent = formatter.format(now);
    const date = document.createElement('span');
    date.textContent = dateFormatter.format(now);
    clock.append(time, date);
  };
  update();
  const timer = window.setInterval(update, 1000);
  return () => { window.clearInterval(timer); clock.remove(); };
}
