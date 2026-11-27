import { countKinds, mergeCounts, type Counts } from '../../core/inventory';
import type { KV } from '../../core/kv';
import { registerObject } from '../../core/object-registry';
import { houseKey, loadRoomDefs } from '../../core/room-def';
import { ensureLedger, housekeeping, usableCounts } from '../../core/units/ledger';
import { starterHouse } from '../../sim/house/starter';
import { DEFAULT_KEY, savedKinds } from './store';

// Une las unidades firmadas con las casas guardadas: lo colocado en cualquiera de tus rooms está «en uso».

/**
 * Registra los muebles de serie y crea tu libro de unidades la primera vez (a partir de lo que ya tuvieras: el inventario
 * antiguo de contadores, o lo colocado, o los muebles de serie). Después cumple los contratos que hayan vencido.
 */
export function startInventory(kv: KV, privateKey: Uint8Array, author: string): void {
  const base = starterHouse(author);
  base.objects.forEach(registerObject);
  const old = kv.get<Counts | null>('inventory.v1', null);
  const saved = savedKinds(kv);
  const initial = old && Object.keys(old).length ? old : saved.length ? countKinds(saved) : countKinds(base.state.objects.map((o) => o.kind));
  ensureLedger(kv, privateKey, initial, Date.now());
  housekeeping(kv, privateKey, Date.now());
}

/** Unidades colocadas en todas tus rooms (Tu Room y las creadas por ti). */
export function usedUnits(kv: KV, author: string): Counts {
  const hasMain = kv.get<unknown>(DEFAULT_KEY, null) !== null;
  const main = hasMain ? savedKinds(kv) : starterHouse(author).state.objects.map((o) => o.kind);
  const others = loadRoomDefs(kv).map((d) => countKinds(savedKinds(kv, houseKey(d.id))));
  return mergeCounts(countKinds(main), ...others);
}

/** Unidades que puedes usar ahora mismo: las tienes, no están comprometidas en una oferta y los préstamos no han vencido. */
export const ownedUnits = (kv: KV, author: string): Counts => usableCounts(kv, author, Date.now());
