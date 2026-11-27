# Espacio: nave, estrella y mundo procedural

Estado: módulo puro en `src/sim/space/` (sin render, sin red) con tests, y una **primera conexión al render**: la experiencia «Tu estrella» (`src/experiences/star`, ruta `#/room/star`, en Explorar). Tu Room (Casa) sigue funcionando igual y es el interior de la nave.

## Historia que guía el diseño

Tu espacio es una **nave**. Empiezas con un mini tutorial de controles dentro; sales a arreglar algo, falla (lluvia de meteoritos vista desde fuera) y caes al planeta cercano. Tu nave queda estrellada en un chunk de tu mundo y tienes que repararla con piezas que encuentras (cofres, estructuras). Al repararla puedes viajar a otras partes del mundo público y guardar/extraer objetos. Otras estrellas serían otra semilla de mundo (futuro).

Por ahora solo se explora **el interior** de la nave; el exterior es el mundo procedural.

## Piezas (`src/sim/space`)

| Archivo | Qué hace |
|---|---|
| `noise.ts` | hash y ruido de valor solo con enteros y aritmética básica (determinista entre navegadores) |
| `sheets.ts` | **ficha de objeto**: material, etiquetas (catálogo cerrado), dureza, durabilidad, `visual` |
| `biome.ts` | altitud + humedad → bioma (pradera, arenal, roquedal, nevada, ceniza); cada uno fija suelo y densidades |
| `templates.ts` | plantillas de estructura (cabaña, ruina, campamento, hangar) y su colocación por regiones |
| `chunk.ts` | `generateChunk(semilla, cx, cy)`: suelo, estáticos, props, cosas con estado |
| `edits.ts` | ediciones por chunk, plegado en orden canónico, botín determinista, punto de control |
| `world.ts` | vista con caché (`openSpace`), colisión (`solidAt`), punto de aparición |
| `ship.ts` | nave como espacio con posición, módulos, reparar, entrar/salir, morir (cápsula) |
| `spaces.ts` | semillas y acceso: nave del dueño, mundo público, mundo privado de amigos |
| `story.ts` | historia: pasos, hechos que los cierran, objetivos en pantalla, guardado validado |
| `camera.ts` | distancia libre de la cámara frente a muros y casco |
| `lens.ts` | lentes (normal, bioma, sólidos, durabilidad, puntos) y nivel de detalle |
| `texture.ts` | tiles de suelo y hojas generados (bytes RGBA) |

## Ficha de objeto

La **colisión vive en la sim, no en el mesh**. Cada tipo tiene una ficha; la sim lee las etiquetas (`solido`, `empujable`, `recogible`, `abre`, `botin`…) y el render lee `visual` (forma y tono). Cambiar un cubo por un GLB cambia solo `visual`. Arbustos y pinos son **props sin colisión**.

## Tres capas de un chunk

1. **Suelo y estáticos**: función pura de la semilla. Nunca se guardan.
2. **Props** (arbusto, pino, roca suelta): posición sub-celda en octavos de celda. Si alguien mueve uno, pasa a ser cosa con id `gen:<cx>,<cy>:p:<n>`.
3. **Cosas con estado** (cofres, cubos): id estable `gen:<cx>,<cy>:<kind>:<n>`. Solo entran en el registro cuando alguien las toca.

## Estructuras entre chunks

El mundo se divide en regiones de 32 celdas (2×2 chunks). Cada región tiene 0 o 1 estructura que **cabe entera dentro de su región**. Un chunk solo mira la estructura de su región, y una estructura que cruza el borde queda cosida en ambos chunks (hay test). Para estructuras más grandes que una región habría que mirar regiones vecinas: pendiente.

## Ediciones y réplica sin servidor autoritativo

Una edición es `{id, t, by, seq, op}` con `op` ∈ `move | take | open | set`. Se pliegan ordenadas por `(t, by, seq, op)`: el resultado **no depende del orden de llegada**. Si dos jugadores hacen lo mismo sobre lo mismo (abrir el mismo cofre), gana la primera y la otra queda en `rejected`. El botín de un cofre (`lootOf`) y el id de cada unidad (`lootUnitId`) salen de (mundo, id), así que un doble cobro por dos desconectados se detecta al reencontrarse y no duplica piezas.

Limitación: un objeto movido fuera de su chunk de origen sigue registrado en el chunk de origen. Como los empujes son de un paso, basta cargar los vecinos.

## Hash dorado

`space.test.ts` fija el hash de dos chunks. **Si cambia, cambió la generación** y las ediciones ya guardadas dejarían de encajar. Cambiar la generación = nueva versión de semilla/mundo, no editar el test.

## Nave

- Estados: `flying`, `crashed`, `landed`.
- La nave tiene una posición en el mundo (casco 7×3 sólido, escotilla bajo el centro). `crashSite` elige un sitio libre, determinista.
- Al estrellarse se rompen casco y motor; energía y comunicaciones según la semilla.
- Reparar gasta piezas que **llevas encima** (`cable`, `placa`, `nucleo`).
- Entrar: junto a la escotilla. Salir: a la escotilla; en vuelo solo con traje y al vacío (`orbit`).
- **Morir**: despiertas en la nave; lo que llevabas queda en una cápsula recuperable en el sitio; lo guardado en la nave no se toca. (La versión dura, perderlo, quedaría como modo opcional.)

## Espacios y acceso

- Nave: semilla = tu clave pública (la que ya usa Tu Room), solo entra el dueño. **Lo guardado en `house.v1` sigue valiendo** (test de migración).
- Mundo público: semilla compartida, relay.
- Mundo privado: semilla derivada con separación de dominio (`privateStarSeed`), nunca de las 24 palabras; dueño y amigos; sincronización p2p.

## Lentes (ver los datos en vez del aspecto)

Mismo dato, otra lectura: `bioma`, `solidos`, `durabilidad`, `puntos` (puntos azules sobre negro). `lodFor(distancia)`: 0 puntos, 1 cubos, 2 formas, 3 texturas. Sirve de depuración y de herramienta (escáner de la nave).

## Texturas

`tileTexture(bioma, semilla, 16)` produce un tile repetible (ruido periódico, 2 tonos y motas). `leafTexture` produce hojas con alfa 0/255 para planos cruzados, en el estilo de tus GLB (foliage: 6 triángulos; pino: 75).

## Tu estrella (render)

`src/experiences/star/index.ts`: tercera persona o cenital sobre tu planeta (semilla `privateStarSeed`). Suelo por chunk con el tile del bioma (canvas con filtrado nearest), props instanciados (hojas en planos cruzados, pinos cónicos), muros y cosas con estado, niebla, casco de la nave y escotilla. Radio de 3 chunks alrededor.

- Mover: WASD/flechas o pad; arrastrar gira la cámara. Colisión con `space.solidAt`.
- Empujar: andar contra un cubo empujable genera una edición `move`; si la sim la rechaza (muro, otra cosa), no pasa nada.
- Botón de acción cerca de algo: Abrir cofre, Coger, Reparar o Entrar (junto a la escotilla; entrar lleva a Tu Room).
- Guardado local: ediciones, nave, lo que llevas y tu posición (`star.*.v1` en el kv).
- Cámara que no se deja tapar (`camera.ts`, pura): se acerca si un muro o el casco queda entre ella y tú, con suavizado.
- Nave por voxels (`hullVoxels`, pura): el daño se ve (huecos y quemaduras si el casco está roto, motor a medias, panel de energía apagado, antena solo con comunicaciones). Al reparar se reconstruye.
- Lentes como botón (normal, bioma, sólidos, durabilidad, puntos): cambia el suelo y oculta los objetos.
- Limitaciones: lo recogido son cantidades «encima de ti», aún **no** unidades firmadas; no hay muerte, meteoritos ni tutorial; no hay guardado en la nave; sin sincronización.

## Historia (`story.ts`)

Pasos: `tutorial → salir → meteoritos → caída → reparar → lista`. Cada paso se cierra con un **hecho** de la sim (`moved`, `looked`, `used`, `atHatch`, `exited`, `meteorsDone`, `landed`, `repaired`), nunca con un temporizador. Lo que no corresponde al paso actual se ignora. El tutorial se puede saltar (`skipTutorial`). Al pasar de meteoritos a caída la historia devuelve el efecto `crash`: ella no toca la nave, la pide. `reconcileShip` deja la nave coherente con el paso, `planetOpen` dice si se puede estar en el planeta y `objectives` da el texto de pantalla (distinto para táctil y teclado). El guardado (`story.v1`) se valida siempre: si no sirve, se empieza de cero.

## Historia en el juego (fases B y C)

- **Tu Room es el interior de la nave** y tiene una **escotilla**: marca naranja con marco en el centro de la pared sur (`hatchSpot`). El botón Usar se llama «Salir» junto a ella cuando el planeta está abierto.
- **Tutorial** (solo Tu Room, no las rooms creadas): cuatro objetivos en pantalla (moverte, mirar, usar un objeto, acercarte a la escotilla). Empiezas pegado a la escotilla, así que ese objetivo solo cuenta cuando ya te has movido. Hay botón «Saltar tutorial». Los textos cambian según sea táctil o teclado.
- **Salir** → lluvia de meteoritos (`src/ui/meteors.ts`, Canvas 2D a pantalla completa, con botón «Saltar»; con «reducir movimiento» dura menos de un segundo) → la historia pide `crash` → la nave se guarda estrellada (`star.ship.v1`) → te lleva a `#/room/star`.
- **Recarga a mitad**: si recargas durante los meteoritos se repiten; si recargas en la caída se completa y entras al planeta. Nada se pierde porque cada paso se guarda al cumplirse (`story.v1`).
- **Tu estrella está cerrada** hasta la caída: si entras antes, avisa y te devuelve a la nave.
- **Restos de la nave**: `salvage(ship, space)` coloca dos cajones de salvamento junto al casco (`gen:<cx>,<cy>:salvage:<n>`, botín en `state.loot`). `openSpace.setExtras` los mezcla con los del chunk. Con ellos la historia siempre tiene final aunque los cofres del mundo no alcancen.
- **Reparar la última pieza** avanza la historia a «lista» (`repaired`).
- **Probado en navegador**: planeta bloqueado al inicio, objetivos uno a uno, saltar tutorial, escotilla, meteoritos, aterrizaje con la nave estrellada y paso a «reparar».
- **Pieza clave aprendida**: los objetos de la casa están en voxels (8 por celda); cualquier cálculo de cercanía debe dividir entre `VPC`. `nearObject` recibe celdas.
- **La lluvia actual es una versión ligera.** La escena 3D exterior (nave en el espacio, cámara en tercera persona, impacto) queda pendiente.

## Mejorar la nave visualmente

Estado: silueta de nave en voxels de 1 m (morro, cuerpo, alas, cabina de cristal, aleta con antena, dos toberas, franja de color) con el daño visible. Desde cerca sigue pareciendo hecha de bloques. Caminos, de menos a más trabajo:

1. **Más resolución**: voxels de 0,5 m (cuatro veces más detalle) con la misma máscara de colisión de 1 m. Es solo cambiar `hullVoxels` y la escala de dibujo.
2. **Cámara de nave**: una vista cenital más alta o una órbita para verla entera (la cenital actual corta el morro).
3. **Variantes por semilla**: silueta, colores y franja distintos para cada jugador.
4. **Nave hecha a mano** en el Taller (objeto voxel de hasta 16 por lado) y usarla como `visual`.
5. **GLB opcional** como `visual`, sin tocar colisión ni etiquetas.

## Qué falta

1. Pulir el render: sombras reales, GLB opcionales, mejor modelo de avatar.
2. Rebanada vertical: tutorial en primera persona, animación de caída (solo cámara), módulos reparables desde la sim.
3. Ampliar reglas: condiciones, variables, acciones (consumir objeto, estado de módulo, cambiar de espacio).
4. Sincronización por chunk con puntos de control; separar presencia del registro.
5. Estructuras mayores que una región; moverse entre chunks con el casco de la nave cruzando bordes.
6. Cápsulas y botín como unidades firmadas del libro (hoy `lootUnitId` solo da el id).
7. Retirar Mundo 3D actual y Room clásica cuando haya paridad.
