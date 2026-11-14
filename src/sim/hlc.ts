export type HLC = { t: number; c: number };

export class HLClock {
  private last: HLC = { t: 0, c: 0 };
  private readonly source: () => number;

  constructor(source: () => number) {
    this.source = source;
  }

  tick(): HLC {
    const physical = this.source();
    const t = Math.max(physical, this.last.t);
    const c = t === this.last.t ? this.last.c + 1 : 0;
    this.last = { t, c };
    return { ...this.last };
  }

  observe(remote: HLC): HLC {
    const physical = this.source();
    const t = Math.max(physical, this.last.t, remote.t);
    let c: number;
    if (t === this.last.t && t === remote.t) c = Math.max(this.last.c, remote.c) + 1;
    else if (t === this.last.t) c = this.last.c + 1;
    else if (t === remote.t) c = remote.c + 1;
    else c = 0;
    this.last = { t, c };
    return { ...this.last };
  }

  peek(): HLC {
    return { ...this.last };
  }

  reset(hlc: HLC): void {
    this.last = { ...hlc };
  }
}