// Permisos de una room. Dos capas independientes:
//  · RoomPolicy  → reglas FIJAS de la experiencia (las declara su RoomConfig). Snake: cámara bloqueada y sin edición.
//  · Access      → quién es quién en una room con dueño (Tu Room): dueño, editores y si los visitantes pueden mirar.
// Todo es puro: la misma función sirve en el cliente hoy y en un relay mañana.

export type Role = 'owner' | 'editor' | 'visitor';

export type Capability =
  | 'view' // ver la room
  | 'play' // jugar (arcade)
  | 'move' // mover / girar objetos que no están bloqueados
  | 'manage' // colocar o guardar objetos del inventario
  | 'lock' // bloquear / desbloquear objetos
  | 'share' // cambiar editores, visibilidad y cámara fija
  | 'camera'; // mover o hacer zoom a la cámara

export type Visitors = 'view' | 'none';

export type Access = {
  /** clave pública (hex) del dueño */
  owner: string;
  /** claves públicas (hex) con permiso de mover objetos */
  editors: readonly string[];
  visitors: Visitors;
};

export type RoomPolicy = {
  /** 'locked': nadie (tampoco el dueño) mueve ni hace zoom a la cámara */
  camera: 'free' | 'locked';
  /** 'none': la room no se edita (juegos). 'access': depende del rol */
  edit: 'none' | 'access';
};

export type PermissionContext = {
  policy: RoomPolicy;
  /** el dueño fijó la cámara de esta room (se suma a la política) */
  cameraLocked?: boolean;
  visitors?: Visitors;
};

const norm = (hex: string) => hex.trim().toLowerCase();

export function roleOf(access: Access, actor: string): Role {
  const a = norm(actor);
  if (a === norm(access.owner)) return 'owner';
  if (access.editors.some((e) => norm(e) === a)) return 'editor';
  return 'visitor';
}

export function canRole(role: Role, cap: Capability, ctx: PermissionContext): boolean {
  const sees = role !== 'visitor' || (ctx.visitors ?? 'view') === 'view';
  switch (cap) {
    case 'view':
    case 'play':
      return sees;
    case 'camera':
      return sees && ctx.policy.camera === 'free' && !ctx.cameraLocked;
    case 'move':
      return sees && ctx.policy.edit === 'access' && role !== 'visitor';
    case 'manage':
    case 'lock':
    case 'share':
      return ctx.policy.edit === 'access' && role === 'owner';
  }
}

export function can(access: Access, actor: string, cap: Capability, policy: RoomPolicy, cameraLocked = false): boolean {
  return canRole(roleOf(access, actor), cap, { policy, cameraLocked, visitors: access.visitors });
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Dueño',
  editor: 'Editor',
  visitor: 'Visitante',
};
