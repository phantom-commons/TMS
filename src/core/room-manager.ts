import type { Identity } from '../identity/keys';
import { loadExperience, soloCan, type ExperienceHandle } from './experience-registry';
import type { KV } from './kv';
import { roomById, type RoomConfig } from './room-config';
import { configOfDef, isCustomId, roomDefById } from './room-def';

// Room Manager: abre una room por id, monta su experiencia en el contenedor y la desmonta al salir.
// No sabe nada de juegos ni de habitaciones: solo de configuraciones.

export type RoomManagerDeps = {
  host: HTMLElement;
  identity: Identity;
  author: string;
  kv: KV;
  toast: (message: string, ms?: number) => void;
  exit: () => void;
  go: (hash: string) => void;
};

export type RoomManager = {
  readonly currentId: string | null;
  open: (roomId: string) => Promise<boolean>;
  close: () => void;
};

export function createRoomManager(deps: RoomManagerDeps): RoomManager {
  let current: { config: RoomConfig; root: HTMLElement; handle: ExperienceHandle } | null = null;
  let ticket = 0; // invalida cargas lentas si el usuario ya se fue a otro sitio

  const close = () => {
    ticket++;
    if (!current) return;
    try {
      current.handle.destroy();
    } catch (e) {
      console.error('error al cerrar la room:', e);
    }
    current.root.remove();
    current = null;
    deps.host.hidden = true;
  };

  const open = async (roomId: string): Promise<boolean> => {
    const def = isCustomId(roomId) ? roomDefById(deps.kv, roomId) : undefined;
    const config = def ? configOfDef(def) : roomById(roomId);
    if (!config) {
      deps.toast('esa room no existe');
      return false;
    }
    if (config.launch === 'page' && config.href) {
      window.location.assign(`${location.pathname}${config.href}`);
      return true;
    }
    if (current?.config.id === roomId) return true;
    close();
    const mine = ++ticket;

    const factory = await loadExperience(config.experience);
    if (mine !== ticket) return false;
    if (!factory) {
      deps.toast(`la experiencia «${config.experience}» no está registrada`);
      return false;
    }

    const root = document.createElement('div');
    root.className = `room-root room-${config.type}`;
    root.dataset.room = config.id;
    deps.host.append(root);
    deps.host.hidden = false;
    try {
      const handle = await factory({
        root,
        config,
        identity: deps.identity,
        author: deps.author,
        kv: deps.kv,
        can: soloCan(config),
        toast: deps.toast,
        exit: deps.exit,
        go: deps.go,
      });
      if (mine !== ticket) {
        handle.destroy();
        root.remove();
        return false;
      }
      current = { config, root, handle };
      return true;
    } catch (e) {
      console.error('no se pudo abrir la room:', e);
      root.remove();
      deps.host.hidden = true;
      deps.toast('no se pudo abrir la room');
      return false;
    }
  };

  return {
    get currentId() {
      return current?.config.id ?? null;
    },
    open,
    close,
  };
}
