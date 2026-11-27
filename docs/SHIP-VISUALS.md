# Forma de la nave: cómo darle forma y cambiarla

## Respuesta corta
Sí, Three.js mejora la nave de verdad. Prototipo hecho: `src/render/ship-mesh.ts` (malla procedural low-poly, ~370-390 triángulos; el pino GLB tiene 75). Se ve como nave y el daño se nota. Los voxels siguen como alternativa (botón de estilo en Tu estrella, kv `star.hull`).

## Qué manda sobre qué
- **Colisión**: sale de `HULL_MASK` (9×5) en `src/sim/space/ship.ts`. Nunca del mesh. Cambiar la forma visual no toca la sim.
- **Visual**: solo el render. Puede ser voxels, malla procedural o GLB.

## Caminos para darle forma
1. **Procedural en Three.js** (hecho): `LatheGeometry` para el fuselaje, `ExtrudeGeometry` para alas, esfera para la cabina, conos/cilindros para toberas y llama, `flatShading`. Se cambia la forma editando parámetros (radios del perfil, envergadura, etc.).
2. **Variantes por semilla**: los mismos parámetros derivados de la semilla del dueño (largo, ala, color, franja).
3. **GLB hecho a mano** (Blender u otro): se carga por hash SHA-256 con `asset-manifest.ts`/`asset-store.ts`, igual que los árboles. Debe llevar nodos con nombre para el daño.
4. **Exportar la procedural a GLB** para retocarla en Blender: `src/render/export-glb.ts` (GLTFExporter). Ya exportadas en `docs/assets/`: `nave-procedural-danada.glb` (391 tris, 16 nodos) y `nave-procedural-reparada.glb` (367 tris, 14 nodos).

## Nodos con nombre (contrato para cualquier GLB)
`Nave, Casco, Franja, Ala_N, Ala_S, PuntaAla_N, PuntaAla_S, Cabina, Aleta, Antena, Tobera_N, Tobera_S, Llama_N, Llama_S, Quemadura_i`.
El render muestra/oculta/tiñe nodos según el estado de los módulos (casco gris y ala corta si está roto, cabina apagada sin energía, sin llama sin motor, antena doblada sin comunicaciones). Un GLB que respete los nombres hereda el daño gratis.

## Límites
- Presupuesto: mantener < ~500 triángulos por nave; es un mundo con muchas cosas.
- Desde cerca aún falta detalle (texturas, sombras reales).
- La escena exterior 3D (caída, impacto) sigue pendiente; usaría esta malla.

## Lab
Las formas se editan en `#/room/lab` (sliders → `ShipParams`). La receta es JSON corto y estable; la procedural lee solo datos, nunca código.
