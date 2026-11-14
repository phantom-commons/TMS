# TMS: comportamiento local-first actual

## Habitación personal

- Sin el parámetro `room` en la URL, TMS abre una habitación local asociada a la identidad activa.
- La habitación y sus eventos se guardan en IndexedDB. No se abre una conexión al relay y el historial no se publica automáticamente.
- Los eventos locales están firmados y encadenados por identidad. El estado del mundo y los índices de historial se reconstruyen a partir de esos eventos.

## Habitación conectada

- `?room=<id>` es una elección explícita para conectarse a una habitación del relay. Para sincronizar una habitación personal existente hay que abrirla con el mismo ID (visible en el título de la pestaña).
- Los eventos nuevos se guardan primero en la cola local. Después de sincronizar el encabezado remoto, se envían en orden; los eventos aceptados pasan a la caché confirmada.
- Si la conexión cae, la cola no se borra. Los eventos pendientes se vuelven a ofrecer después de la siguiente sincronización.
- Un evento rechazado y los eventos posteriores de esa cadena no se eliminan automáticamente.

## Límites que siguen pendientes

- Aún no existe `RoomManifest`, control de visibilidad `private/friends/public`, invitaciones ni ACL en el relay. Conocer el ID de una habitación conectada basta actualmente para intentar leer y escribir en ella; el ID no es una política de privacidad.
- La habitación personal queda local, pero todavía no existe una interfaz para publicarla, compartirla o cambiar sus reglas.
- `DOOR` y `NOTE` están reservados pero el relay y el replay los rechazan hasta que tengan transiciones y permisos definidos.
- Todavía no hay sincronización cifrada extremo a extremo, snapshots/checkpoints ni resolución automática de conflictos después de un reinicio del relay.
