# Fase 10J.1 — Central de Emergencias

Base funcional implementada con adaptador **determinista de demostración**. No es un modelo generativo real y no realiza llamadas externas.

## Archivos

- Creados: `emergency-central.ts`, `emergency-central.test.ts`, `emergency-central.socket.test.ts` en esta carpeta, y este informe.
- Modificados: `manager.ts`, `socket.ts`, `chat.ts`; web `TeamChat.tsx`, `TeamChat.test.ts`, `styles.css`.
- Adaptadas las pruebas aisladas de chat `chat.test.ts` y `chat.socket.test.ts` con un adaptador silencioso; el script `scripts/ui-check-10i.mjs` diferencia mensajes humanos de automáticos al contar envíos.

## Ciclo y acontecimientos

El gestor observa estados confirmados, construye una proyección mínima, identifica acontecimientos nuevos y entrega únicamente esa proyección al ciclo de la Central. Se selecciona una intervención pertinente, el adaptador prepara una respuesta, se valida y se comprueba de nuevo su vigencia antes de publicarla en el chat.

Desencadenantes: presentación al inicio, apertura de voto de ruta, segundo intento tras el primer desacuerdo, necesidad pública de transporte, gas del último intento de transporte y fallecimiento confirmado. Si coinciden consecuencias se prioriza una; el gas tiene prioridad. No se generan acontecimientos ni efectos de juego nuevos.

La proyección contiene ronda, fase, cantidad de humanos activos, cantidad pública que necesita transporte, tipo/identificadores/intento/tiempo restante de votación e identificadores de acontecimientos. **No contiene** salud, energía, inventario, información clínica, nombres de rutas ocultas, categorías estructurales, objetivos, sabotaje, tiradas ni mensajes humanos. No se entrega la sala ni el estado completo al adaptador.

## Publicación y protección

- Respuestas TypeScript `warn`, `advise`, `summarize` o `none`, validadas en tiempo de ejecución. Solo las tres primeras publican texto; ninguna ejecuta operaciones del motor.
- Campos adicionales, longitud fuera de 1–400, HTML, cifras y términos reservados del sabotaje/riesgo se rechazan. Esta defensa inicial del contenido deberá revisarse junto con las instrucciones y validaciones del modelo real en 10J.2.
- Remitente `server`, nombre **Central de Emergencias**, estilo dorado diferenciado y mismo historial ordenado/acotado del chat. Los clientes no pueden enviar ese tipo de remitente.
- Idempotencia por acontecimiento y como máximo una intervención por intento. F5 no reinicia estos registros ni duplica mensajes. Las intervenciones no consumen el presupuesto de frecuencia ni las solicitudes humanas.
- Respuestas descartadas si cambian ronda, fase, decisión o intento, si desaparece el acontecimiento, si termina la partida o si superan cinco segundos de espera. Ese plazo es configurable en el ciclo. La eliminación de la instancia también invalida respuestas pendientes.
- Las excepciones, rechazos de promesas y respuestas inválidas no bloquean el juego. `none` permite no intervenir.

## Validación

**906 pruebas aprobadas, cero fallos, 76 archivos.** Pruebas específicas durante el desarrollo y una única ejecución final de la suite completa. TypeScript, compilación y `git diff --check` correctos.

Cobertura: seis desencadenantes reales, proyección sin secretos ni conversación humana, `none`, estructura inválida, fallo síncrono/asíncrono, caducidad, cambios de ronda/intento, finalización, cierre del gestor, duplicados, misma votación sin reinicio, estado de simulación intacto, cuatro clientes Socket.IO, F5, aislamiento entre salas, rechazo de suplantación y presupuesto humano independiente. React comprueba el estilo reservado del remitente del servidor. Sin revisión visual interactiva adicional en esta fase.

Para revisar manualmente: iniciar con cuatro perfiles, comprobar la presentación única, abrir una votación de ruta y dejar fallar su primer intento; comprobar las orientaciones. En una decisión real de transporte, revisar necesidad de ayuda y aviso de gas. Recargar una sesión: debe recuperar los mensajes existentes sin nuevas intervenciones. El chat humano y los votos siguen disponibles.

## Pendiente para 10J.2

Conectar otro adaptador a `EmergencyAdapter`, configurar credenciales únicamente en servidor y definir las instrucciones/validación del modelo real. Se reutilizarán proyección, ciclo, control de vigencia y publicación existentes. No se instala SDK ni se configura proveedor en esta fase.

Sin cambios en `docs/`, mecánicas, probabilidades, costes, objetivos o temporizadores. Sin dependencias nuevas, commit, push ni avance a 10J.2.
