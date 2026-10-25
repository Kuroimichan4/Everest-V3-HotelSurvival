# Fase 10E.1 — Presentación, reloj, avisos y ficha privada

## Alcance y archivos

Se conservan los cambios anteriores de la copia de trabajo. Esta fase no modifica docs/, reglas del motor, objetivos individuales, inventarios, recompensas, costes, probabilidades, víctimas de accidentes ni momento de visibilidad del riesgo del Arquitecto. No incorpora veneno, coste técnico adicional de ronda 2, dependencias, IA ni PostgreSQL. Sin commit ni push.

Creados:
- apps/web/src/GameIntroduction.tsx: presentación pública antes del inicio.
- apps/web/src/presentation.test.ts: pruebas de presentación y fixtures de navegador.
- apps/server/src/rooms/introduction.socket.test.ts: cuatro conexiones reales, espera sin reloj, autorización, reconexión y privacidad.
- scripts/ui-check-10e1.mjs: inspección geométrica y capturas con Edge sin ventana.
- apps/web/PHASE_10E_1.md: este informe.

Modificados:
- apps/web/src/Lobby.tsx: muestra la introducción durante la espera, antes del inicio existente.
- apps/web/src/VotePanel.tsx: franja destacada VoteStatus y número de intento sin el incorrecto «3 de 2».
- apps/web/src/GameScreen.tsx: un único reloj destacado, ficha abierta y avisos contextuales.
- apps/web/src/Transport.tsx: aviso de necesidad, segundo intento, acuerdos y continuidad de los avisos existentes de gas/explosión.
- apps/web/src/CharacterSheet.tsx: apartado explícito de capacidades y responsabilidad.
- apps/web/src/styles.css: franja de tiempo, urgencia, aviso y adaptación móvil.
- apps/server/src/rooms/character-sheets.ts: textos privados de Botones y Médico.
- apps/server/src/rooms/character-sheets.test.ts: texto médico incierto y Botones sin conocimiento privado de huéspedes.
- apps/web/src/game-state.test.ts y RoundFour.test.ts: expectativas adaptadas a ficha abierta y reloj destacado.

## Cuenta atrás

La franja está inmediatamente debajo de la cabecera y permanece visible al desplazar la página. Muestra decisión vigente, intento y segundos grandes (40–64 px en las anchuras comprobadas). A diez segundos o menos añade texto de urgencia y borde doble, además del color. Incluye la extraordinaria de transporte.

Comparte el VoteClockProvider ya existente. Se elimina la cuenta pequeña de la cabecera de juego y el panel no crea otra cuenta cuando está dentro del proveedor. El cálculo sigue utilizando deadline y serverNow; no se alteran plazos ni cierres, votos ni autorizaciones. F5 recupera la decisión y su vencimiento del servidor. Al cerrarse la votación desaparece la franja. No se superpone una ventana modal a las acciones.

## Introducción e inicio sincronizado

La introducción aparece en la sala de espera, antes del botón «Iniciar partida». Contiene la narración del terremoto y una explicación breve de seis rondas, roles, información privada, objetivos, decisiones con plazo, salud, energía, suministros limitados y coordinación.

Se reutiliza el inicio existente, sin un segundo botón posterior ni una fase local que pueda saltarse con F5. Mientras el servidor mantiene la sala en waiting no existe partida ni temporizador. Solo room:start, autorizado al anfitrión y con cuatro participantes conectados, crea la ronda 1 y su plazo. Todos reciben started y sus datos propios. Recargar antes de iniciar conserva waiting; recargar después recupera la partida, sin volver a la introducción ni reiniciar el reloj.

La coordinación de lectura corresponde al anfitrión: no se añade un sistema de confirmación individual «he leído».

## Avisos de transporte

- Al abrir transporte se destacan los compañeros que necesitan ayuda, la exclusividad de los votantes elegibles y las consecuencias graves de no acordar. El tiempo está en la franja única.
- Durante el segundo intento se informa de que el primero terminó sin mayoría. No se equipara falta de mayoría con abstención de todos.
- Tras el segundo fracaso se conserva la narración de tubería/gas y el daño propio confirmado; se anuncia el intento extraordinario cuando realmente está abierto.
- Tras el tercero se conserva explosión, daño propio adicional, fallecimientos y abandonos reales, con explicación de evacuación del sector sin recorrido ordinario cuando corresponde.
- Un acuerdo se presenta como aprobado. Si falta la selección del destinatario o la ejecución está bloqueada, se dice que el desplazamiento está pendiente. Solo completed permite afirmar que se completó y mostrar transportados/abandonados confirmados.
- Las decisiones encadenadas muestran sus acuerdos independientes. Una aprobación previa no inventa un destinatario ni una ejecución.

Los avisos son paneles declarativos identificados por preparación y decisión, derivados de la instantánea actual. No hay una cola de toasts, sonidos o diálogos que se reproduzcan al reconectar. Recibir la misma instantánea no añade copias; F5 restaura un único panel contextual vigente. El historial conserva sus identificadores existentes. No se guarda información privada en un nuevo almacenamiento del navegador.

## Ficha y textos

La ficha propia se muestra directamente, sin acordeón: nombre del rol, capacidades/responsabilidad, objetivo individual y conocimientos autorizados. En escritorio sigue en la sección lateral; en móvil las acciones conservan prioridad y la ficha se lee en el flujo de página, sin superposiciones ni recortes.

Botones gestiona packs compartidos y distribuye suministros energéticos. Se eliminan las referencias a información privilegiada sobre ubicaciones o situación personal de huéspedes. Se conserva su conocimiento autorizado del almacén y su objetivo de que sobrevivan al menos dos huéspedes adicionales. No cambian acciones ni objetivo.

El Médico describe sus capacidades de consultar salud y administrar tratamientos. La información de la conferencia mantiene «podrías encontrar suministros médicos» y explicita que no hay garantías de que sigan intactos ni se conoce la cantidad aprovechable. No se alteran las recompensas reales ni se difunde ese conocimiento a otros roles.

## Privacidad

Se reutilizan los canales y la proyección privada existentes. La ficha solo se emite a su propietario; React además rechaza una ficha cuyo participantId no coincida. Los avisos emplean nombres, estados y acuerdos públicos, y solo el daño numérico propio que ya llega proyectado. No representan energía exacta ajena. Médico, Arquitecto y Mantenimiento conservan sus permisos actuales. No se han añadido listeners ni eventos de juego.

## Validación

- Vitest: 686 pruebas aprobadas en 56 archivos (base: 674 en 54).
- TypeScript: correcto para shared, server y web.
- Compilación de los tres paquetes: correcta, incluida producción Vite.
- git diff --check: correcto.
- Cuatro sockets reales: introducción/espera compartida, ningún temporizador durante lectura, F5 en espera, rechazo del inicio por no anfitrión, inicio único y ficha propia por conexión.
- Se mantienen las pruebas de 10C.1 sobre F5 en los tres intentos, plazos 60/30/10, gas/explosión, sincronización y privacidad.
- Edge sin ventana: ocho combinaciones de introducción/juego a 1440, 900, 390 y 320 px. Sin desbordamiento horizontal; un reloj en juego, ninguno en introducción; números legibles, ficha sin acordeón y controles fuera de la franja del reloj.
- Se han inspeccionado capturas de escritorio y móvil. Son fixtures React renderizados con el CSS real; no sustituyen una revisión interactiva de una partida completa en navegador.

El primer intento de depuración de Edge dentro del aislamiento no respondió. La comprobación fuera del aislamiento terminó correctamente. Se corrigió asimismo un import sin usar detectado por TypeScript antes de la validación final.

Artefactos locales: .cache/10e1/game-1440.png, game-900.png, game-390.png, game-320.png, intro-*.png y layout-result.json. Se regeneran ejecutando la prueba presentation.test.ts y después node scripts/ui-check-10e1.mjs. El script utiliza Edge instalado o BROWSER_EXECUTABLE.

## Revisión manual

1. Reunir cuatro participantes y leer la introducción. Esperar y recargar antes de iniciar: no deben aparecer votos ni reloj. Comprobar inicio desde el anfitrión.
2. Revisar el reloj en rescates, rutas y transporte, cambiar voto y recargar. El intento y vencimiento deben conservarse; solo debe verse una cuenta atrás.
3. Provocar transporte y dejar vencer 60/30/10: comprobar aviso de segundo intento, gas y extraordinaria, explosión y continuación. Probar también acuerdo y selección entre dos agotados.
4. Comprobar que un acuerdo pendiente no anuncia recorrido completado; revisar que las recargas no añadan paneles o historiales duplicados.
5. Revisar cada ficha privada en escritorio y móvil: objetivo y conocimientos propios visibles, datos ajenos ausentes. Comprobar los textos de Botones y Médico.
6. Verificar interacción, desplazamiento de página y botones en los navegadores habituales, especialmente durante los diez segundos extraordinarios.

## Pendientes

No se han detectado nuevas cuestiones de reglas en esta fase. Siguen vigentes las excepciones ya documentadas en 10C.1, como la ausencia de votantes autorizados después del gas. El veneno, el nuevo coste técnico de ronda 2 y los cambios de 10C.2 quedan fuera de esta intervención.

Trabajo detenido para revisión del usuario.