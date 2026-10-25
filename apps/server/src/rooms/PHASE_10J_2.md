# Fase 10J.2 — Scroll y supervivientes NPC

## Cambios

- El agente anterior y sus pruebas se sustituyen por `survivor-agent.ts`, `survivor-agent.test.ts` y `survivor-agent.socket.test.ts`. No queda una Central activa en paralelo.
- `manager.ts`: proyección narrativa exclusiva de encuentros reales y conexión del agente al flujo existente.
- `chat.ts` y `packages/shared/src/index.ts`: remitente de servidor identificado por encuentro NPC.
- `TeamChat.tsx`, nuevo `chat-scroll.ts`, `chat-scroll.test.ts`, `TeamChat.test.ts` y `styles.css`: scroll, indicador y presentación NPC.
- `introduction.socket.test.ts` y `voting.test.ts`: aserciones de temporizadores adaptadas a los dos mensajes programados adicionales, manteniendo los plazos y casos anteriores.
- `scripts/ui-check-10i.mjs`: selector de mensajes humanos actualizado; nuevo `scripts/ui-check-10j2.mjs`: comprobación real del scroll en navegador.

## Scroll

La posición de lectura se registra mediante el evento de scroll, antes de que un mensaje nuevo aumente la altura. Al abrir o recuperar el historial se muestra el final. Si el usuario estaba al final, se sigue automáticamente la conversación; si está leyendo más arriba, se conserva su posición y aparece «mensajes nuevos · Ir al final». Abrir de nuevo el panel también lleva abajo. Se mantiene el orden cronológico y los límites de 400 caracteres, un segundo y 150 mensajes.

## Agente NPC

Solo recibe contexto cuando está abierta la votación NPC real de ronda 1, 2 o 6. Las votaciones de rutas y transporte humano no lo activan. En ronda 6 se comprueba la aparición real y si el superviviente camina con ayuda o está inmóvil; si no aparece, no hay mensajes.

El contexto contiene identificador de encuentro, ronda, situación pública, identificadores y tiempos del intento, momento de intervención y lo que ese NPC ya dijo. No contiene información de humanos, salud, energía, riesgos, objetivos, sabotaje, inventario ni conversación humana.

Un único ciclo reutiliza programación, generación, validación y publicación del chat. El adaptador determinista de **demostración**, sin llamadas externas, utiliza súplicas y argumentos propios de cada encuentro e intento. No es IA generativa real.

## Programación y cancelación

- Primer intento: segundos **0, 20 y 40** desde su apertura real.
- Segundo intento: segundos **0 y 15** desde su propia apertura. Los intervalos son configurables en el agente.
- Se usa el reloj autoritativo del servidor. No se modifican los temporizadores de votación.
- Al cerrar o cambiar la votación, desaparecer el contexto o terminar la partida se cancelan las intervenciones pendientes. Cada callback vuelve a comprobar identidad, intento, plazo y vigencia antes de generar y antes de publicar.
- Cada momento tiene una clave de encuentro/decisión/intento/posición. F5 no reinicia la programación ni repite mensajes. Las respuestas asíncronas obsoletas, caducadas o inválidas se descartan. El fallo del generador no bloquea la partida.

## Chat y aspecto

El servidor crea el remitente «Superviviente de ronda …», con identificador NPC y etiqueta visible **NPC**. Los mensajes tienen fondo y borde dorados diferentes de los humanos, se incorporan al historial ordenado y se recuperan por la sesión autenticada. El cliente no puede atribuirse ese tipo de remitente. No se utilizan ventanas emergentes ni se consumen solicitudes o frecuencia humanas.

## Verificación

Pruebas específicas con reloj falso: tiempos 0/20/40 y 0/15, cancelaciones, historial de lo dicho, ausencia de tercer intento, NPC reales de rondas 1/2/6, ronda 6 sin aparición, privacidad, errores, respuestas tardías y cuatro clientes Socket.IO con F5 entre intervenciones.

Edge sobre la aplicación real, con historial de más de ochenta mensajes: **1440, 900, 390 y 320 px**. Pasan apertura al final, seguimiento de mensajes altos, lectura anterior sin interrupción, indicador que vuelve al final, reapertura y F5; sin desbordamiento horizontal. Resultados y capturas en `.cache/10j2/`.

La primera validación general detectó cinco aserciones antiguas que contaban únicamente los temporizadores de votación. Se corrigieron para incluir los nuevos temporizadores NPC; sus 53 pruebas específicas pasan. La suite general se repite únicamente para verificar esa corrección.

Resultado final: **911 pruebas aprobadas, cero fallos, 77 archivos**. TypeScript, compilación de producción y `git diff --check` correctos.

## Próximo paso

Conectar un modelo real sustituyendo `SurvivorAdapter.respond`, conservando contexto, programación, validación e idempotencia. No se instala SDK, no se hacen llamadas externas ni se avanza a esa fase.

Sin cambios en reglas de rescate, costes, probabilidades, accidentes, objetivos, sabotaje ni documentos originales de `docs/`. Sin commit ni push.
