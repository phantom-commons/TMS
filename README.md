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

## Cuenta: invitado → guardada

Al abrir no hay pantalla de registro: se crea una clave de **invitado** (`Invitado-xxxx`), recordada en este dispositivo, y se entra directo al menú. Mientras no se guarde, Inicio muestra un aviso. En **Perfil → Guardar cuenta**: se ven las 24 palabras, se confirman 3 al azar y se elige un `@usuario` y una contraseña (8+) que cifran la clave en este navegador (después se pide la contraseña al abrir). **Ya tengo cuenta** importa unas 24 palabras en otro dispositivo. La identidad es la clave; el `@usuario` es una etiqueta local hasta que un relay pueda reservarlo. Lógica en `src/identity/account.ts`, diálogos en `src/shell/account-dialog.ts`.

## Menú y rooms (shell móvil)

La app sin parámetros abre un **shell ligero** (sin Three.js): Inicio · Explorar · Tu Room · Inventario · Perfil.
Three.js solo se descarga al entrar a `?exp=world` o `?room=<id>`.

- `src/core/room-config.ts` — cada room es una configuración (vista, controles, features, política de permisos). Añadir una room = una entrada en `ROOMS` + registrar su experiencia.
- `src/core/room-manager.ts` + `experience-registry.ts` — abren/cierran experiencias bajo demanda.
- `src/core/permissions.ts` — roles (dueño / editor / visitante) y política de la room (`camera: 'locked'` en los juegos).
- `src/experiences/social/` — **Tu Room**: habitación isométrica con bloques (cama, silla, escritorio, ventana…). El dueño mueve, gira, bloquea y guarda; puede dar permiso de edición a otras claves, hacer la room privada o fijar la cámara. Todo cambio pasa por `applyOp(layout, op, rol)`.
- **Vistas por room** (`src/core/room-config.ts`): cada room declara `view.allowed` y `view.default`, además de `mode` (`solo`/`shared`) y `resolution` (subdivisiones enteras por casilla). `resolveView` decide la vista efectiva: la elección del jugador solo cuenta si la room la permite y la cámara no está bloqueada. En Tu Room, el botón ◇/▦ alterna isométrica ↔ cenital (se guarda por jugador); en el resto de rooms la lista ya es declarativa, pero el motor 3D aún no la aplica.
- `src/experiences/arcade/` — **Snake** y **Salto** (tipo dinosaurio): cámara fija, récords locales, controles adaptativos (`src/input/adaptive.ts`: teclado, táctil con pad/gestos, mando).

Rutas: `#/home`, `#/explore`, `#/inventory`, `#/profile`, `#/room/<id>`.

## Nodos y reglas (sim entera)

`src/sim/nodes/` es el núcleo de reglas ajustables. Un **tipo de nodo** es código auditado (esquema en `catalog.ts`, comportamiento en `engine.ts`);
una **instancia** es solo datos dentro de un **manifiesto** (`manifest.ts`: árbol `world / player / prefabs`). Un manifiesto no puede traer comportamiento nuevo.

- `params.ts` — parámetros con esquema (mín/máx/defecto): validan, se acotan y generan la interfaz de sliders (`experiences/arcade/rules-panel.ts`).
- `engine.ts` — todo entero: punto fijo (`FP`), ticks fijos, semilla dentro del estado. Mismas reglas + semilla + entradas = mismo `simHash`.
- `manifestFingerprint` — huella del árbol + versión de cada tipo de nodo: dos clientes con la misma huella ejecutan las mismas reglas.
- `presets/runner.ts` — **Salto** como datos puros (gravedad, salto, vida, generador, movimiento, daño). Snake sigue con su motor propio.

Rutas de entrada: sin parámetros abre el shell; `?exp=world` / `?room=<id>` el mundo 3D.
En el 3D: arrastrar para mirar (1ª/3ª persona, se ajusta a cuartos de vuelta), menú de acciones en rejilla, y cielo simple u HDRI en Ajustes.

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
