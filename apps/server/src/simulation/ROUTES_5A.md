# Fase 5A: motor de rutas de ronda 2

`routes.ts` contiene un catálogo interno de definiciones y una operación común
de desplazamiento. No modifica el número de ronda de `SimulationState`, ni
ejecuta rescates o votaciones; no está conectado a salas, Socket.IO o React.

Decisiones aprobadas: pasillo (10 energía, 35 %, 20 daño), ventilación
(20 energía, 10 %, 5 daño), apuntalamiento (30 energía, 20 %, 10 daño).
El coste se paga por cada humano vivo al comenzar el desplazamiento. Los
fallecidos no se desplazan. Con dos vivos ambos pueden ser víctimas.

Una muestra uniforme en [0, 1) decide el accidente mediante `muestra < probabilidad`.
Solo si ocurre se usan otras dos muestras para extraer dos víctimas de una
copia de la lista de vivos, eliminando cada seleccionada. El llamador debe
inyectar una fuente uniforme. Las muestras inválidas producen rechazo.

La operación compone `spendEnergy` y `applyDamage` sobre estados provisionales
inmutables y devuelve el estado original por referencia ante cualquier rechazo.
Se permite terminar con energía cero. Los rechazos anteriores a la tirada no
consumen azar. Un rechazo posterior sí puede haber consumido muestras: la
transacción protege el estado de simulación, no retrocede una fuente externa.

Las vistas se construyen campo a campo (identificador, nombre y coste); nunca
copian la definición interna. La vista pública incluye pasillo y apuntalamiento;
la información privada adicional de Mantenimiento incluye ventilación, sin
riesgos. No se han definido revelaciones adicionales de peligro para el Arquitecto
en esta fase: tampoco recibe el riesgo de ventilación. Las fichas permanecen
intactas. Estas funciones no autentican: al integrarlas, el servidor deberá
obtener el rol desde la sesión y comprobar la autorización del destinatario.

## Pendientes para integrar ronda 2

- Con un único superviviente: `single-survivor-pending`, antes de pagar o tirar.
  Se bloquea provisionalmente toda la operación para no introducir un resultado
  dependiente de una regla de accidente aún no aprobada.
- Sin vivos: `no-living-characters`; no define un final de partida.
- Apuntalamiento sin alguno de los dos especialistas vivos:
  `specialist-availability-pending`. No se decide si heredar conocimientos.
- Si el accidente seleccionado causaría fallecimientos:
  `fatal-accident-order-pending`. No confirma ni costes ni daño hasta aprobar el
  orden excepcional de resolución; el motor básico de daño sigue intacto.
- Integrar la secuencia rescate → voto de ruta → desplazamiento → consecuencias
  y resumen, con autorización, ocultación/revelación de opciones y resolución
  única por desplazamiento. Esta primitiva no ofrece idempotencia de una ronda.
- Aprobar el manejo de energía insuficiente, agotamiento y casos excepcionales.
  No hay consumo automático de packs ni tratamientos.

La petición de fase 5A actualiza el pendiente anterior de los documentos:
con exactamente dos vivos las dos víctimas son esos dos humanos. Los documentos
originales se conservan sin cambios.
