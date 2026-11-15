# TMS

Sala compartida en el navegador (Three.js). El estado se reconstruye desde un log firmado y encadenado
(Ed25519 + SHA-256 + HLC). El relay es tonto: ordena, valida con la misma sim y guarda.

## Arrancar

```bash
npm install
npm run relay     # opcional: ws://localhost:8787  (en Codespaces: puerto 8787 → Public)
npm run dev       # vite
npm test && npm run lint && npm run check
```

## Cómo funciona (offline primero)

- Tu identidad son **24 palabras**. De tu clave pública salen `homeRoomId` (`home-xxxxxxxxxxxx`) y la
  **semilla** de tu habitación (`src/sim/worldgen.ts`): pilares, cubos iniciales y tono del suelo.
- Al arrancar se firma `INIT` + `PLACE` **localmente** y quedan como *pendientes* en IndexedDB:
  funciona sin red y sobrevive a recargar.
- Con relay conectado, los pendientes se envían (con ritmo) y el relay los confirma/ordena (`rseq`).
  Si borras `relay.db`, tu cliente lo vuelve a sembrar con tu propia cadena.
- Visitas: Ajustes → *Copiar enlace para visitas* (`?room=home-…`). Quien entra necesita el relay.
  Nadie puede crear una `home-*` ajena: la sim rechaza un INIT que no firma su dueño.
- La puerta azul lleva a `lobby`; en el lobby, a tu home.

## Atrium y escenario 3D

`?room=atrium` (o el botón 🏛 de la puerta) crea una sala con plantilla: el `INIT` solo lleva `layout: 'atrium'`
y las celdas salen de `src/sim/layouts.ts` (determinista, igual en cliente y relay): nave con columnas y altar central.
`src/render/stage-atrium.ts` es pura presentación (no firma nada): sigilo en el suelo grabado con los 64 hex de la
semilla, anillo con un eslabón por evento firmado (los últimos 64), columnas con cristal y luz, cornisa, arco de la
puerta, linterna que sigue al avatar y polvo. Ajustes → *Escenario 3D* lo cambia a «Clásico».

## HUD

`src/ui/hud.ts` agrupa estado, minimapa (con calor de visitas y flecha de la cámara), brújula, aviso contextual,
chat plegable (Enter), leyenda de atajos y botones rápidos. Cada pieza tiene su interruptor en Ajustes; el inspector
sigue fijo abajo a la izquierda (siempre / al pasar o click / apagado).

## Controles

WASD/flechas mover (también empuja cubos) · F recoger/soltar · L bloquear · C cámara · Q/E girar (1ª/3ª persona) ·
R menú radial · Enter chat · F2 panel dev · rueda: zoom · click en objeto: inspector · arrastrar objeto: empujar.

Ajustes (⌘): cámara (5), inspector (siempre / al pasar o click / apagado), interruptores de interfaz y red.
