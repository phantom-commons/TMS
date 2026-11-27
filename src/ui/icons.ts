// Iconos de línea minimalistas (SVG en línea, color heredado). Sustituyen a los emojis en los menús.

const P: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  room: '<path d="M4 20V8l8-4 8 4v12"/><path d="M4 20h16"/><path d="M9 20v-6h6v6"/>',
  bag: '<path d="M6 8h12l1 12H5z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4-6 8-6s7 1.5 8 6"/>',
  snake: '<path d="M5 18h8a4 4 0 000-8H9a3 3 0 010-6h10"/><circle cx="19" cy="4" r="0.6"/>',
  run: '<path d="M3 19h18"/><path d="M7 19v-5h4v5"/><path d="M14 19v-9h4v9"/>',
  world: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  atrium: '<path d="M3 8l9-5 9 5"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/><path d="M4 20h16"/>',
  tools: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><path d="M13 16.5h7M16.5 13v7"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 017.5-2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  paint: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  erase: '<path d="M5 15l8-9 6 6-6 6H8z"/><path d="M10 20h9"/>',
  door: '<path d="M6 21V4h12v17"/><path d="M4 21h16"/><circle cx="15" cy="12.5" r="0.7"/>',
  walk: '<circle cx="12" cy="5" r="2"/><path d="M12 8v6M9 21l3-7 3 7M8 11l4-1 4 1"/>',
  edit: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
};

export type IconName = keyof typeof P | (string & {});

/** SVG de línea para un nombre conocido; cadena vacía si no existe. */
export function icon(name: string, size = 22): string {
  const d = P[name];
  if (!d) return '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
