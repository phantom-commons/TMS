import { verifyEntry, type LogEntry } from './log';
import { GENESIS_HASH } from './hash';
import { applyEntry, replay } from './replay';
import type { World } from './world';

export type RelayEntry = { rseq: number; relayTime: number; entry: LogEntry };
export type ApplyResult = { accepted: RelayEntry[]; error?: string; gap?: boolean };

export class RoomState {
  readonly roomId: string;
  private confirmed: RelayEntry[] = [];
  private pending: LogEntry[] = [];
  private heads = new Map<string, { seq: number; hash: string }>();
  private confirmedWorld: World | null = null;
  // Confirmadas + pendientes. Se construye una vez y se actualiza incrementalmente con cada acción propia.
  private optimistic: World | null = null;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  get lastRseq(): number {
    return this.confirmed.length ? this.confirmed[this.confirmed.length - 1].rseq : 0;
  }

  hasInit(): boolean {
    return this.confirmed.length > 0 || this.pending.some((p) => p.type === 'INIT');
  }

  entries(): readonly RelayEntry[] {
    return this.confirmed;
  }

  allEntries(): LogEntry[] {
    return [...this.confirmed.map((item) => item.entry), ...this.pending];
  }

  pendingList(): readonly LogEntry[] {
    return this.pending;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Total de eventos (confirmados + pendientes) sin copiar la lista. */
  get entryCount(): number {
    return this.confirmed.length + this.pending.length;
  }

  // Entradas ya ordenadas por el relay. Verifica todo: el relay no es de fiar.
  applyConfirmed(items: RelayEntry[]): ApplyResult {
    const accepted: RelayEntry[] = [];
    if (!this.confirmedWorld && this.confirmed.length) {
      this.confirmedWorld = replay(this.confirmed.map((item) => item.entry));
    }
    for (const it of items) {
      if (it.rseq <= this.lastRseq) continue; // duplicado
      if (it.rseq !== this.lastRseq + 1) return { accepted, gap: true };

      const e = it.entry;
      if (e.roomId !== this.roomId) return { accepted, error: `wrong room at rseq ${it.rseq}` };

      let valid = false;
      try {
        valid = verifyEntry(e);
      } catch {
        /* entrada malformada */
      }
      if (!valid) return { accepted, error: `bad hash or sig at rseq ${it.rseq}` };

      const head = this.heads.get(e.author);
      const chained = head
        ? e.seq === head.seq + 1 && e.prevHash === head.hash
        : e.seq === 0 && e.prevHash === GENESIS_HASH;
      if (!chained) return { accepted, error: `broken chain at rseq ${it.rseq}` };
      if (!this.confirmedWorld) {
        if (e.type !== 'INIT') return { accepted, error: 'first entry must be INIT' };
        try {
          this.confirmedWorld = replay([e]);
        } catch (error) {
          return { accepted, error: `invalid INIT at rseq ${it.rseq}: ${(error as Error).message}` };
        }
      } else if (!applyEntry(this.confirmedWorld, e)) {
        return { accepted, error: `invalid ${e.type} action at rseq ${it.rseq}` };
      }

      this.heads.set(e.author, { seq: e.seq, hash: e.hash });
      this.confirmed.push(it);
      this.pending = this.pending.filter((p) => p.hash !== e.hash);
      accepted.push(it);
    }
    if (accepted.length) this.optimistic = null;
    return { accepted };
  }

  // Siguiente seq / prevHash de tu cadena (cuenta tus pendientes).
  nextFor(author: string): { seq: number; prevHash: string } {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.author === author) return { seq: p.seq + 1, prevHash: p.hash };
    }
    const h = this.heads.get(author);
    return h ? { seq: h.seq + 1, prevHash: h.hash } : { seq: 0, prevHash: GENESIS_HASH };
  }

  lastOf(author: string): LogEntry | null {
    for (let i = this.confirmed.length - 1; i >= 0; i--) {
      if (this.confirmed[i].entry.author === author) return this.confirmed[i].entry;
    }
    return null;
  }

  addPending(entry: LogEntry): void {
    this.pending.push(entry);
    if (this.optimistic) {
      applyEntry(this.optimistic, entry); // semánticamente inválida: se ignora (el relay la rechazará)
    } else if (this.pending.length === 1) {
      // primera pendiente: parte de una copia del mundo confirmado
      try {
        if (this.confirmedWorld) {
          this.optimistic = structuredClone(this.confirmedWorld);
          applyEntry(this.optimistic, entry);
        } else if (entry.type === 'INIT') {
          this.optimistic = replay([entry]);
        }
      } catch {
        this.optimistic = null;
      }
    } else {
      this.optimistic = null; // se reconstruye en world()
    }
  }

  dropPending(): void {
    if (this.pending.length === 0) return;
    this.pending = [];
    this.optimistic = null;
  }

  // Confirmadas + pendientes (optimista). null si la room aún no existe.
  world(): World | null {
    if (this.pending.length === 0) return this.confirmedWorld;
    if (!this.optimistic) {
      try {
        if (this.confirmedWorld) {
          const w = structuredClone(this.confirmedWorld);
          for (const p of this.pending) applyEntry(w, p);
          this.optimistic = w;
        } else if (this.pending[0].type === 'INIT') {
          this.optimistic = replay(this.pending);
        }
      } catch {
        this.optimistic = null;
      }
    }
    return this.optimistic;
  }
}
