# Sincronización con el relay: por qué se «teletransportaba» y qué se cambió

## Síntoma
Al conectar con el relay la sala «recargaba»; si te movías mientras tanto, el avatar saltaba de sitio, o la sincronización
no terminaba nunca y el movimiento quedaba roto.

## Causas (confirmadas contra el relay real)
1. **Se firmaba antes de saber qué había en el relay.** Cada MOVE es una entrada firmada que encadena con la anterior de tu
   cadena (`seq` + `prevHash`). Mientras llegaba el SYNC, el cliente ya firmaba pasos sobre la cabeza de cadena que tenía en
   caché. Si el relay tenía más entradas tuyas (caché vacía o vieja, otra pestaña), esos pasos chocaban: el relay respondía
   «seq ya usado» y el cliente ejecutaba `dropPending()`, que descarta TODAS las pendientes. Al desaparecer esos pasos, el
   avatar volvía de golpe a la última posición confirmada. Ese era el salto.
2. **Tu casa se creaba antes de sincronizar.** Con la caché vacía, `ensurePresence()` del arranque enviaba INIT, los cubos
   iniciales y ENTER enseguida (`ownHome`), también con `seq` ya usado.
3. **Un error en el SYNC dejaba el cliente colgado.** Ante cualquier `res.error` (cadena rota, acción inválida) `onSync`
   hacía `return` sin llegar a `ready`: nunca más se enviaba nada, y los pasos se acumulaban en local sin poder confirmarse.

## Qué se cambió
- `src/net/sync-gate.ts` (puro, con tests): decide qué hacer tras cada SYNC (`ready` / `resync` / `rebuild` / `fail`) y qué
  acciones se retienen (`MOVE`, `INTERACT`) mientras se sincroniza.
- Mientras se sincroniza **no se firman** MOVE/INTERACT; se avisa con un toast corto. INIT/ENTER de tu casa esperan a estar
  al día, o a que se declare modo local.
- Una caché que no encaja se **descarta una vez** y se vuelve a pedir desde cero (conservando solo tus pendientes). Si aun así
  falla, o se superan `MAX_RESYNCS` peticiones, se declara fallo en vez de colgarse.
- **Cronómetro** (`SYNC_TIMEOUT_MS`, 8 s): si no se completa, se avisa y se libera el movimiento en modo local.
- Tras una reconexión de una sesión que ya funcionó, se vuelve a exigir sincronizar; si nunca funcionó, se queda en local.

## Cómo se comprobó
Relay real (`npm run relay`), cliente compilado con `VITE_RELAY_URL=ws://localhost:8787`, Playwright:
(a) moverse a los 250 ms de abrir la sala, y (b) vaciar solo la caché de la sala (stores `room` y `pending`) y volver a entrar
moviéndose. Antes del cambio (b) daba «rechazado: seq ya usado» (5 rechazos en el relay); después, 0 rechazos.

## Lo que esto NO resuelve (dirección)
- **La posición sigue siendo parte del registro firmado.** Cada paso es una entrada permanente. Lo correcto es separar
  **presencia** (posición en vivo, efímera, sin firmar ni guardar, el avatar propio se mueve al instante en local) de
  **registro** (objetos, propiedad, cambios de la sala, firmado y permanente). Con eso un paso perdido ya no puede
  corromper nada.
- **Entrar con checkpoint + cola.** Hoy el SYNC repite todo el registro desde `since`. Un snapshot firmado cada cierto tiempo
  permitiría entrar con el último checkpoint y repetir solo lo posterior (la misma pieza sirve para las unidades de objeto).
- Dos pestañas con la misma cuenta siguen pudiendo bifurcar su propia cadena; el relay lo rechaza y se resuelve con resync.
