import type { KV } from '../../core/kv';
import { signDoc, verifyDoc, type SignedDoc } from '../../core/signed-doc';
import { defaultLayout, validateLayout, type RoomLayout } from './model';

// El layout de Tu Room se guarda firmado por el dueño. Si alguien edita el almacenamiento a mano,
// la firma no cuadra y se vuelve al layout inicial en lugar de cargar datos manipulados.

const DOMAIN = 'TMS_ROOM_LAYOUT';
const KEY = 'room.my-room';

export type LoadedLayout = { layout: RoomLayout; fresh: boolean; rejected: boolean };

export function loadLayout(kv: KV, owner: string): LoadedLayout {
  const raw = kv.get<SignedDoc<RoomLayout> | null>(KEY, null);
  if (!raw) return { layout: defaultLayout(owner), fresh: true, rejected: false };
  const l = raw.doc;
  const ok =
    verifyDoc(DOMAIN, raw, owner) &&
    l?.v === 1 &&
    l.owner.toLowerCase() === owner.toLowerCase() &&
    validateLayout(l) === null;
  if (!ok) return { layout: defaultLayout(owner), fresh: true, rejected: true };
  return { layout: l, fresh: false, rejected: false };
}

export function saveLayout(kv: KV, layout: RoomLayout, privateKey: Uint8Array): void {
  kv.set(KEY, signDoc(DOMAIN, layout, privateKey));
}
