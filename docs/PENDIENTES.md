# Pendientes y decisiones (actualizado 21-nov-2026)

Resumen vivo de qué está hecho, qué falta y qué se decidió. Detalle técnico del espacio en [SPACE.md](SPACE.md); unidades en [UNITS.md](UNITS.md); relay en [RELAY-SYNC.md](RELAY-SYNC.md).

## Decisiones tomadas
- Un solo espacio procedural desde una semilla. Tu espacio es una **nave** (solo interior por ahora); el mundo es la **estrella/planeta**. Un mundo público para todos y uno privado solo para amigos.
- Historia: tutorial en la nave → salir → meteoritos → caída → reparar con piezas encontradas (cofres, estructuras). Una sola estrella pública; otras estrellas son otra semilla (futuro).
- Objetos con **ficha de datos** (material, etiquetas de catálogo cerrado, dureza, durabilidad, `visual`). Cubos con etiqueta primero; GLB después, solo cambiando `visual`.
- Colisión en la sim, no en el mesh. Arbustos y pinos son props sin colisión que solo se mueven (pasan a ser cosa al tocarlos).
- **Morir**: despiertas en la nave y lo que llevabas queda en una cápsula recuperable; lo guardado en la nave nunca se toca. Perderlo del todo sería un modo opcional. Aún no hay nada que mate.
- Tutorial **saltable**. Depositar al entrar a la nave será **manual** (no implementado).
- Hosting sin autoridad: registros firmados replicados, orden canónico, transporte intercambiable (relay, WebRTC, QR). Botín con id de unidad derivado del lugar para detectar dobles cobros.
- `src/sim/space` (no `src/space`): es base de la sim y entrará en el registro.
- Un hash dorado fija la generación; cambiarla = nueva versión de mundo.

## Hecho
- Contactos (tarjeta firmada, libreta, selector en Dar, tocar avatar en el mundo 3D).
- Módulo del espacio: fichas, biomas, chunks, estructuras, ediciones sin orden, nave, lentes, texturas, cámara, historia, guardado de la nave.
- Tu estrella (render): suelo con textura por bioma, props instanciados, cosas con estado, empujar, cofres, nave en voxels con daño, lentes, sombra, cámara sin oclusión.
- Tutorial en Tu Room con escotilla y objetivos; lluvia de meteoritos ligera; caída y paso al planeta.
- **Restos de la nave** (`salvage`): dos cajones junto al casco con exactamente las piezas para reparar lo roto, más un cable de sobra. Antes un sondeo mostró que en 4 de 40 semillas el botín aleatorio de 9×9 chunks no alcanzaba y la historia se quedaba sin final. Probado de punta a punta en navegador (tutorial → caída → abrir cajones → reparar todo → «lista»).
- 318 tests; tsc, eslint, servidor y build limpios.

## Pendiente, por prioridad
**Siguiente (fase D/E)**
1. Escena 3D exterior para la salida y la caída (hoy es una pantalla 2D).
2. Panel de módulos dentro de la nave: qué pide cada uno, qué llevas, qué hay guardado.
3. Almacén de la nave: «encima» frente a «guardado», depósito manual.
4. Primer peligro real para que la cápsula de muerte tenga sentido (meteoro con aviso). Hasta entonces `die`/`recover` no se usan.

**Piezas como unidades firmadas (fase F)**
- Acuñar el botín con `lootUnitId`; ubicaciones de la unidad (encima / almacén) en el libro.
- Rooms que referencien unidades concretas (hoy guardan tipos).

**Visual**
- Nave: voxels de 0,5 m, cámara que la muestre entera, variantes por semilla, nave hecha en el Taller, GLB opcional.
- Sombras reales, avatar mejor, props con más variedad por bioma.

**Red y sincronización**
- Sincronización por chunk con puntos de control; mundo público por relay; privado por conexión directa o QR.
- Separar presencia del registro en el relay (arregla de raíz la recarga lenta).
- Testigos: navegadores en la sala firman el orden de los recibos. Intercambio atómico en una «sala de canje».
- Copia de seguridad o exportación del libro (hoy solo en el navegador).

**Contactos**
- Solicitud mutua para espacios solo de amigos; buzón en el relay; @usuario reservado; lista visible en el mundo 3D antiguo.

**Reglas y creación**
- Condiciones, variables y acciones nuevas en el motor de reglas (consumir objeto, estado de módulo, cambiar de espacio, lanzar animación) cuando la historia lo pida. `recolor` es transitoria.
- Props y Labs sobre los chunks nuevos (empujar/mover pinos y arbustos en la interfaz).

**Estructuras**
- Estructuras mayores que una región; objetos que cruzan chunks lejanos.

**Limpieza**
- Retirar el Mundo 3D actual y Room clásica cuando Tu estrella tenga paridad.
- Mover el test de migración fuera de `sim` (importa de `experiences`).
- El tutorial solo existe en Tu Room; si alguien ya jugaba antes de esta versión arranca el tutorial desde cero (no hay migración de progreso).

## Límites conocidos (honestidad)
- Lo recogido en Tu estrella son cantidades «encima de ti», no unidades firmadas.
- El ledger vive solo en el navegador. Sin testigos, «el primero gana» depende de la vista local.
- Los cofres del mundo siguen dando botín aleatorio; solo los cajones de salvamento garantizan lo necesario. Si se añaden más módulos, `salvage` los cubre solo porque suma `MODULES[m].needs`.
- El tutorial «usar un objeto» cuenta si hay un objeto a dos celdas o menos, no que el objeto reaccione.
- La lluvia de meteoritos no depende de la sim ni del dispositivo: dura lo mismo y se puede saltar.
- La nave desde cerca sigue pareciendo hecha de bloques.

## Cómo probar a mano
1. Borra `story.v1`, `star.*` y `house.v1` del almacenamiento del navegador (o usa una ventana privada).
2. Abre Tu Room: deben salir 4 objetivos y «Saltar tutorial».
3. Muévete, arrastra para mirar, pulsa Usar junto a un objeto y vuelve a la escotilla: pasa a «Sal por la escotilla».
4. Junto a la escotilla pulsa Usar: meteoritos → planeta con la nave estrellada.
5. Abre `#/room/star` en una ventana nueva: debe devolverte a la nave.


## Añadido: panel de nave y forma visual
- Panel «Nave» en Tu Room (`src/ui/ship-panel.ts`): módulos con lo que piden, lo que llevas, lo guardado; guardar/sacar manual; reparar avanza la historia. Botón visible cuando el planeta está abierto.
- Carga separada llevada/guardada (`src/sim/space/cargo.ts`).
- Forma de la nave: ver `docs/SHIP-VISUALS.md`.
- Pendiente: probar el panel en navegador; escena 3D exterior; peligros para que la cápsula importe.

## Lab (`#/room/lab`, en Inicio)
- Página dentro del juego para modelar/probar: sliders de forma de la nave (`src/sim/space/ship-params.ts`, datos puros con rangos y `cleanParams`), daño por módulo, triángulos y nodos, receta en texto (copiar/aplicar), variante por semilla, exportar `.glb`, mapa 3×3 chunks con lente y semilla editable.
- «Guardar» deja la forma en `ship.params.v1`; Tu estrella la usa al dibujar la nave.
- No toca colisión ni generación (hashes dorados intactos).
- Siguiente: recetas para props/estructuras/avatar, importar GLB y validar nombres de nodo, probar objetos en un chunk caminable, compartir recetas firmadas.
