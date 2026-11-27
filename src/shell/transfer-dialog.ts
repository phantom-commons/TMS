import { displayName } from '../core/contacts';
import { openContactsDialog } from './contacts-dialog';
import { knownObject, registerObject, saveToLibrary } from '../core/object-registry';
import { objectId, toV2 } from '../core/objects';
import { acceptOffer, decodePacket, encodePacket, integrate, offerUnit, pickFreeUnit, unitStates } from '../core/units/ledger';
import type { Terms } from '../core/units/unit';
import type { ShellApi } from './shell';

// Dar y recibir objetos sin servidor: la oferta y la respuesta son paquetes de texto (la cadena firmada de la unidad)
// que las dos personas se pasan por donde quieran. Más adelante irán por la sala de canje con testigos.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HEX64 = /^[0-9a-f]{64}$/i;

const overlayOf = (title: string, body: string) => {
  const overlay = document.createElement('div');
  overlay.className = 'login-overlay acct-overlay';
  overlay.innerHTML = `<div class="login-card acct-card" role="dialog" aria-modal="true"><h1></h1>${body}<button type="button" class="tx-close secondary">Cerrar</button></div>`;
  overlay.querySelector('h1')!.textContent = title;
  document.body.append(overlay);
  const close = () => overlay.remove();
  overlay.querySelector<HTMLElement>('.tx-close')!.onclick = close;
  return { overlay, close, $: <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T };
};

const copyBtn = (btn: HTMLButtonElement, text: string, api: ShellApi, label = 'Copiado') => {
  btn.onclick = () => {
    void navigator.clipboard?.writeText(text).then(
      () => api.toast(label),
      () => api.toast('No se pudo copiar: selecciónalo y cópialo a mano'),
    );
  };
};

const when = (t: number): string => new Date(t).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });

export function openGiveDialog(api: ShellApi, kind: string, onDone: () => void): void {
  const name = knownObject(kind)?.obj.name ?? 'objeto';
  const { $, close } = overlayOf(
    `Dar: ${name}`,
    `<p class="hint">Elige a quién se lo das, o pega su clave pública. La oferta bloquea esta unidad hasta que caduque o la acepten.</p>
     <button type="button" class="tx-pick secondary">Elegir de mis contactos</button>
     <input class="tx-to" placeholder="clave pública (64 caracteres)" autocomplete="off" autocapitalize="none" spellcheck="false" />
     <select class="tx-kind"><option value="gift">Regalo (pasa a ser suyo)</option><option value="loan">Préstamo (vuelve a ti)</option></select>
     <select class="tx-loan" hidden><option value="1">Lo presto 1 día</option><option value="7" selected>Lo presto 7 días</option><option value="30">Lo presto 30 días</option></select>
     <select class="tx-valid"><option value="1">La oferta vale 1 hora</option><option value="24" selected>La oferta vale 24 horas</option><option value="168">La oferta vale 7 días</option></select>
     <button type="button" class="tx-go">Crear oferta</button>
     <p class="error tx-err"></p>
     <div class="tx-out" hidden><p class="hint">Pásale este paquete. Cuando te devuelva su respuesta, pégala en Recibir para cerrar el trato.</p><textarea class="tx-packet" rows="4" readonly></textarea><button type="button" class="tx-copy">Copiar paquete</button></div>`,
  );
  $<HTMLButtonElement>('.tx-pick').onclick = () =>
    openContactsDialog(api, {
      onPick: (pk) => {
        $<HTMLInputElement>('.tx-to').value = pk;
        $<HTMLButtonElement>('.tx-pick').textContent = `Para: ${displayName(api.kv, pk)}`;
      },
    });
  $<HTMLSelectElement>('.tx-kind').onchange = () => ($<HTMLElement>('.tx-loan').hidden = $<HTMLSelectElement>('.tx-kind').value !== 'loan');
  $<HTMLButtonElement>('.tx-go').onclick = () => {
    const to = $<HTMLInputElement>('.tx-to').value.trim().toLowerCase();
    const err = $<HTMLElement>('.tx-err');
    err.textContent = '';
    if (!HEX64.test(to)) return void (err.textContent = 'La clave pública son 64 caracteres (0-9, a-f).');
    if (to === api.author) return void (err.textContent = 'No puedes dárselo a ti mismo.');
    const now = Date.now();
    const unit = pickFreeUnit(api.kv, api.author, kind, now);
    if (!unit) return void (err.textContent = 'No tienes una unidad libre de este objeto.');
    const terms: Terms = $<HTMLSelectElement>('.tx-kind').value === 'loan' ? { k: 'loan', returnBy: now + Number($<HTMLSelectElement>('.tx-loan').value) * DAY } : { k: 'gift' };
    try {
      const chain = offerUnit(api.kv, api.identity.privateKey, unit.unit, to, terms, Number($<HTMLSelectElement>('.tx-valid').value) * HOUR, now);
      const packet = encodePacket(chain, knownObject(kind)?.obj);
      $<HTMLElement>('.tx-out').hidden = false;
      $<HTMLTextAreaElement>('.tx-packet').value = packet;
      copyBtn($<HTMLButtonElement>('.tx-copy'), packet, api, 'Paquete copiado');
      $<HTMLButtonElement>('.tx-go').hidden = true;
      onDone();
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : 'No se pudo crear la oferta.';
    }
  };
  $<HTMLButtonElement>('.tx-close').addEventListener('click', close);
}

export function openReceiveDialog(api: ShellApi, onDone: () => void): void {
  const { $ } = overlayOf(
    'Recibir',
    `<p class="hint">Tu clave pública (dásela a quien quiera darte algo):</p>
     <textarea class="tx-me" rows="2" readonly></textarea>
     <button type="button" class="tx-copyme secondary">Copiar mi clave</button>
     <p class="hint">Pega aquí el paquete que te han pasado (una oferta, o la respuesta a la tuya):</p>
     <textarea class="tx-in" rows="4" placeholder="tms1.…" spellcheck="false"></textarea>
     <button type="button" class="tx-read">Leer paquete</button>
     <p class="error tx-err"></p>
     <div class="tx-sum hint" hidden></div>
     <button type="button" class="tx-accept" hidden>Aceptar</button>
     <div class="tx-out" hidden><p class="hint">Devuélvele este paquete para cerrar el trato:</p><textarea class="tx-packet" rows="4" readonly></textarea><button type="button" class="tx-copy">Copiar respuesta</button></div>`,
  );
  $<HTMLTextAreaElement>('.tx-me').value = api.author;
  copyBtn($<HTMLButtonElement>('.tx-copyme'), api.author, api, 'Clave copiada');
  let pendingUnit = '';
  $<HTMLButtonElement>('.tx-read').onclick = () => {
    const err = $<HTMLElement>('.tx-err');
    const sum = $<HTMLElement>('.tx-sum');
    err.textContent = '';
    sum.hidden = true;
    $<HTMLButtonElement>('.tx-accept').hidden = true;
    const packet = decodePacket($<HTMLTextAreaElement>('.tx-in').value);
    if (!packet) return void (err.textContent = 'Eso no es un paquete válido.');
    const { chain } = packet;
    const now = Date.now();
    const r = integrate(api.kv, chain, now);
    if (!r.ok) return void (err.textContent = r.fork ? 'Aviso: esta unidad tiene dos historias distintas. Se ha guardado la que viste primero.' : `Paquete rechazado: ${r.reason}`);
    const s = unitStates(api.kv, now).find((u) => u.unit === chain[0]?.hash);
    if (!s) return void (err.textContent = 'No se pudo leer la unidad.');
    // la definición del objeto viaja con la unidad; se acepta solo si su id de contenido coincide con el de la unidad
    if (packet.obj && !knownObject(s.kind)) {
      try {
        if (objectId(packet.obj) === s.kind) {
          registerObject(packet.obj);
          saveToLibrary(api.kv, toV2(packet.obj));
        }
      } catch {
        /* definición inválida: se ignora */
      }
    }
    const name = knownObject(s.kind)?.obj.name ?? 'objeto';
    onDone();
    if (s.status === 'offered' && s.offer && s.offer.to === api.author) {
      const terms = s.offer.terms.k === 'gift' ? 'como regalo' : `en préstamo hasta ${when(s.offer.terms.returnBy)}`;
      sum.textContent = `${displayName(api.kv, s.owner)} te ofrece «${name}» ${terms}. La oferta vale hasta ${when(s.offer.until)}.`;
      sum.hidden = false;
      pendingUnit = s.unit;
      $<HTMLButtonElement>('.tx-accept').hidden = false;
      return;
    }
    sum.hidden = false;
    const involved = chain.some((l) => l.by === api.author);
    sum.textContent =
      s.holder === api.author || s.owner === api.author
        ? `Listo: «${name}» guardado. Estado: ${s.status === 'free' ? 'libre' : s.status === 'loaned' ? 'prestado' : 'ofrecido'}.`
        : involved
          ? `Trato cerrado: «${name}» ya es de ${displayName(api.kv, s.owner)}.`
          : `Paquete guardado, pero no es para ti («${name}»).`;
  };
  $<HTMLButtonElement>('.tx-accept').onclick = () => {
    const err = $<HTMLElement>('.tx-err');
    try {
      const chain = acceptOffer(api.kv, api.identity.privateKey, pendingUnit, Date.now());
      const packet = encodePacket(chain);
      $<HTMLElement>('.tx-out').hidden = false;
      $<HTMLTextAreaElement>('.tx-packet').value = packet;
      copyBtn($<HTMLButtonElement>('.tx-copy'), packet, api, 'Respuesta copiada');
      $<HTMLButtonElement>('.tx-accept').hidden = true;
      $<HTMLElement>('.tx-sum').textContent = 'Aceptado. Ya es tuyo; falta que quien te lo dio reciba tu respuesta.';
      onDone();
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : 'No se pudo aceptar.';
    }
  };
}
