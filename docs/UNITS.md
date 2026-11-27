# Unidades firmadas y recibos

## Idea
Un objeto tiene dos niveles:
- **Definición** (la forma y los colores): inmutable, con id por contenido (`obj:` + hash). Puede estar en cualquier sitio; quien
  la recibe comprueba que su hash coincide con el id.
- **Unidad** (esta espada concreta): tiene su **propia cadena de eslabones**. Cada eslabón lo firma quien tiene derecho a darlo en
  ese momento. La historia viaja con el objeto: no hace falta preguntar a un servidor quién es el dueño.

Código: `src/core/units/` (`unit.ts` reglas y firmas, `receipt.ts` recibos y valor, `ledger.ts` libro local y paquetes).

## Eslabones y quién firma
| Eslabón | Lo firma | Efecto |
|---|---|---|
| `mint` | el creador | crea la unidad; su hash es el id de la unidad |
| `offer` (regalo o préstamo, con plazo) | el dueño | **bloquea** la unidad hasta que caduque la oferta |
| `accept` | el destinatario | regalo: pasa a ser dueño. Préstamo: pasa a ser tenedor |
| `cancel` | el dueño | solo con la oferta ya caducada |
| `return` | el tenedor | devuelve un préstamo cuando quiera |
| `reclaim` | el dueño | recupera un préstamo vencido |

`verifyUnit` comprueba la cadena entera (firmas, encadenado, fechas no futuras, y que cada eslabón lo firme quien puede).
`append` no deja firmar lo que las reglas no permiten.

## Copia y original (doble gasto)
Dos continuaciones distintas de la misma cabeza de cadena son una **bifurcación** (`relate` = `fork`). El libro conserva la historia que
**vio primero** y guarda la otra como prueba (`units.forks.v1`). Ojo: la fecha de cada eslabón la declara quien firma, así que por sí
sola no decide cuál fue primero. Ese «primero visto» debe aportarlo alguien ajeno al trato: los **testigos** (ver abajo). Hoy el
libro es local, así que la protección completa llega con los testigos.

## Contratos con caducidad
Son datos de un catálogo cerrado (regalo, préstamo con `returnBy`, plazo de la oferta), no código. `housekeeping` los cumple al
arrancar y al abrir el Inventario: cancela ofertas caducadas, devuelve préstamos vencidos o los recupera. No se puede borrar la copia
descargada por el prestatario, pero **deja de tener validez**: `canUse` es falso pasado `returnBy`, y la room retira ese objeto.

## Recibos (registro, no moneda)
Un recibo es el registro de UNA transacción de UNA unidad (`gift`, `loan`, `return`, `reclaim`). Se **deriva** de las cadenas: todos
obtienen el mismo `id`. Los testigos (identidades distintas y ajenas al trato) firman ese id; `isWitnessed` exige varios.
**No se intercambian por objetos**: sirven para ver qué circula, qué se presta y quién lo ha tenido. `valueStats` da hechos, no precios:
traspasos, préstamos, personas distintas que lo han tenido (identidades, no transacciones, para que repetir tratos entre las mismas
dos cuentas no infle nada) y cuántos tienen testigos.

## Cómo viajan los datos
Un **paquete** (`tms1.…`) es la cadena completa de la unidad más la definición del objeto. Hoy se pasa a mano (copiar/pegar); la
sala de canje lo hará por red con testigos. Reconstruir = releer cadenas y recibos, que se verifican solos.

## Qué falta
- **Testigos reales**: los navegadores de la sala firman recibos y orden de llegada (`witness`, `addWitness` ya existen).
- **Canje atómico** (dos unidades a cambio de dos) como sub-room.
- **Rooms por referencia**: hoy una room guarda *clases* de objeto y el inventario cuenta unidades; falta que referencie unidades concretas.
- **Checkpoints firmados** del libro para reconstruir rápido.
- Hoy el libro vive en `localStorage` del navegador; borrarlo sin copia pierde las unidades (la cuenta de 24 palabras solo recupera la
  identidad). Pendiente: exportar/copia de seguridad del libro.
