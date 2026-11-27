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

## Objetos propios y Taller
Un objeto es un dato: una rejilla de voxeles (hasta 16 por lado, paleta de hasta 12 colores) con id por contenido (`obj:` + hash). Escala fija del mundo: 1 casilla = 8 voxeles (~1 m). `compileObject` fusiona voxeles en cajas; los objetos v1 siguen validando y conservan su id. El Taller (`src/experiences/workshop`) los edita por capas y los guarda en tu biblioteca (`objects.library`).

## Casa (una room, una sim)
`src/sim/house` es la única sim: enteros, casillas y ticks fijos (20 Hz; un paso = 6 ticks). Nada de render ahí. El render (`src/experiences/house`, Three.js) interpola los pasos y gestiona mirar (yaw/pitch) solo de forma visual. Vistas: primera persona (por defecto), tercera, isométrica y cenital. El editor coloca, mueve, gira y quita objetos con encaje a voxel o a casilla. Los colores salen de `paletteFromSeed(seed)` (puro y determinista): los mismos muebles, otra paleta por semilla. Casa está pensada para sustituir a la Tu Room antigua cuando se decida.

## Relay y sincronización
Notas de por qué se «teletransportaba» al conectar y cómo se arregló: [docs/RELAY-SYNC.md](docs/RELAY-SYNC.md).

## Inventario y unidades firmadas
Cada objeto es una **unidad con su propia cadena firmada** (crear, ofrecer, aceptar, devolver…); la historia viaja con él y se verifica sin servidor. Regalar o prestar con caducidad se hace desde Inventario → «Dar» / «Recibir» pasando un paquete de texto. De cada trato sale un **recibo** (registro, no moneda) y el inventario muestra cuántas veces ha pasado de mano cada objeto. Detalle y límites en [docs/UNITS.md](docs/UNITS.md). «En uso» = colocadas en alguna de tus rooms; «libres» = tuyas − en uso.

## Crear room (reglas como nodos visibles)
Menú: Explorar → «Crear room» (`#/create`). Una room creada es solo datos (`src/core/room-def.ts`): nombre, tamaño (4–14), semilla de color (generador procedural), vistas permitidas y reglas. Los muebles se colocan dentro, en modo Editar, con tu inventario. Las reglas (`src/sim/house/rules.ts`) son pares «cuando → entonces» de un catálogo cerrado:
- Cuando: al entrar · al pisar una casilla · al usar un objeto (botón Usar o tecla F).
- Entonces: decir un mensaje · llevarte a una casilla · cambiar los colores.
Los disparadores se deducen del estado antes/después de cada tick, así que la sim sigue siendo entera y determinista. El botón «Reglas» dentro de la room vuelve al editor.

## Ajustes gráficos

Cada cliente decide (`src/core/graphics.ts`): calidad automática/baja/media/alta, escala de render (100/85/70 %) y contornos. Están en **Perfil → Gráficos** y en el ⚙ de la sala 3D. Afectan a Tu Room, Taller, juegos y escena 3D; no entran en ningún hash ni en la física.

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

## Contactos

Libreta local de claves públicas con nombre (`src/core/contacts.ts`). Se añaden tocando a otro jugador dentro de una sala, pegando su clave, o leyendo su **tarjeta firmada** (`tms-c.…`, firmada con su clave: demuestra que esa clave dice llamarse así; el nombre es solo una etiqueta). Perfil → Contactos; en Dar hay «Elegir de mis contactos». Un alias tuyo no se pisa con el nombre de una tarjeta posterior.

## Espacio (nave, estrella, mundo procedural)

Módulo puro en `src/sim/space/` con ficha de objeto, biomas, chunks, estructuras, ediciones sin orden, nave y lentes. Ver [docs/SPACE.md](docs/SPACE.md). «Tu estrella» (`#/room/star`) es la primera conexión al render.

## Historia y pendientes

Tutorial en Tu Room → salir → meteoritos → caída → reparar la nave en Tu estrella. Estado y decisiones en [docs/PENDIENTES.md](docs/PENDIENTES.md); detalle técnico en [docs/SPACE.md](docs/SPACE.md).
