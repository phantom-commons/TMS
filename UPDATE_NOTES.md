# TMS — actualización local-first

Esta carpeta contiene una versión completa del snapshot de TMS compartido en esta conversación, con las correcciones trabajadas aquí.

## Cambios incluidos

- Inicio con habitación personal local por defecto; `?room=<id>` opta por una habitación conectada al relay.
- Persistencia separada para eventos confirmados y eventos pendientes.
- Conservación de eventos pendientes al perder conexión y reintento tras sincronización.
- Validación local antes de encolar transiciones optimistas.
- Correcciones de identidad/Web Crypto y formato de historial.
- Carga dinámica de los módulos de renderizado Three.js.
- Migración de IndexedDB a versión 7 y reparación automática de almacenes faltantes (`identity`, `log`, `entries`, `room`, `pending`) sin borrar datos existentes.
- Incluye fuentes, pruebas, configuración, lockfile y servidor relay.

## Instalación

Desde la carpeta `TMS-main`:

```bash
npm ci
npm run build
npm test
npm run lint
```

Si el navegador aún conserva una conexión antigua a IndexedDB, cierra todas las demás pestañas de TMS y recarga. La migración v7 comprueba los almacenes existentes y crea los que falten en una actualización de esquema adicional.

## Nota de procedencia y límites

Este paquete parte del snapshot `TMS-main (2).zip` que se compartió en la conversación y de las modificaciones posteriores preparadas sobre ese snapshot. No contiene cambios que solo existan en el Codespace actual y que no estén presentes en ese archivo fuente.

No se incluye `node_modules`, `dist` ni archivos SQLite temporales (`server/relay.db*`). `npm ci` reconstruye las dependencias usando `package-lock.json`.

La sincronización conectada sigue sin implementar ACL, invitaciones o cifrado extremo a extremo. El ID de una sala conectada no debe considerarse un mecanismo de privacidad.
