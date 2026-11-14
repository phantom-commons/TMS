import { ZERO, toDir8, type InputSource, type Vec } from './controller';

export function createGamepad(): InputSource {
  return {
    read(): Vec {
      const pad = navigator.getGamepads?.().find((p) => p?.connected);
      if (!pad) return ZERO;
      const b = pad.buttons;
      const bx = (b[15]?.pressed ? 1 : 0) - (b[14]?.pressed ? 1 : 0); // D-pad
      const by = (b[13]?.pressed ? 1 : 0) - (b[12]?.pressed ? 1 : 0);
      if (bx !== 0 || by !== 0) return { dx: bx, dy: by };
      return toDir8(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.5); // stick izquierdo
    },
    dispose() {},
  };
}