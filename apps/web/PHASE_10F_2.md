# Fase 10F.2 — Interfaz privada y fallecimiento inesperado

## Alcance

Se reutilizan el evento medical:sabotage y las operaciones de 10F.1. No se reimplementa el motor, no se modifica el 25 %, los tratamientos por ronda, los inventarios, las rutas ni el relevo. Se conservan los cambios anteriores del repositorio. Sin modificaciones en docs/, dependencias nuevas, commit ni push.

## Archivos creados

- apps/web/src/BellhopSabotage.tsx: sección privada de capacidad y estados autorizados.
- apps/web/src/sabotage-request.ts: envío único, recibo, reintentos y motivos privados de rechazo.
- apps/web/src/MedicalDeathNotices.tsx: aviso público de fallecimiento con la frase registrada por el servidor.
- apps/web/src/medical-sabotage-ui.test.ts: presentación por rol, estado, deduplicación, privacidad, cierre y fixtures visuales.
- apps/web/src/medical-sabotage-integration.test.ts: cuatro clientes reales con el adaptador de la aplicación, reconexiones y seis rondas.
- scripts/ui-check-10f2.mjs: comprobación de escritorio/móvil con Edge y capturas locales.
- apps/web/PHASE_10F_2.md: este informe.

## Archivos modificados

- apps/web/src/Lobby.tsx: estado privado separado, acción autenticada y comprobación de respuestas.
- apps/web/src/game-socket.ts: suscripción privada, filtro del propietario y limpieza al desconectar/desmontar.
- apps/web/src/GameScreen.tsx: capacidad en la ficha propia, avisos públicos, resultado privado final y etiqueta de anfitrión.
- apps/web/src/game-history.ts: un registro público de muerte inesperada por suceso.
- apps/web/src/styles.css: sección privada compacta y aviso coherente con el diseño oscuro.
- packages/shared/src/index.ts: participantId en el DTO privado para verificar al destinatario.
- apps/server/src/rooms/manager.ts: añade ese identificador al DTO privado existente; no cambia operaciones ni reglas.

Los otros archivos modificados o sin seguimiento que aparecen en git corresponden a fases anteriores y se conservan.

## Botón y estados privados

La ficha autorizada de Botones incorpora «Capacidad especial» y «Manipular medicación». Mantiene el objetivo de muerte por su sabotaje recibido desde el servidor, y los cuatro botones Dar Pack siguen en las tarjetas. Médico, Mantenimiento y Arquitecto no reciben este control ni su confirmación.

El botón utiliza el evento existente con gameId y requestId. El servidor continúa validando sesión, rol, existencias, uso previo y ventana de acción. Pulsarlo no cambia el inventario público, no abre votaciones ni tira dados de envenenamiento.

La interfaz muestra únicamente datos confirmados:

- Disponible cuando el servidor permite la operación.
- Utilizada, con sabotaje pendiente, después de la confirmación.
- Sabotaje activado y objetivo cumplido cuando objectiveFulfilled es verdadero.
- Recuperando estado, no disponible, desconectado o motivo autorizado de rechazo cuando corresponda.

La confirmación privada de manipulación es «Has conseguido manipular la medicación sin que nadie se percate. Ahora solo queda esperar...». La activación muestra «Tu sabotaje ha tenido efecto. Has cumplido tu objetivo individual.» y «Objetivo: Cumplido».

Al terminar sin víctima, el estado final autorizado muestra «Objetivo: Incumplido» y ya no invita a esperar. Un Botones fallecido puede consultar el resultado privado que 10F.1 autoriza, pero no puede actuar. La pantalla final conserva la evaluación privada del servidor.

## Duplicados, respuestas y F5

Un controlador por partida impide más de un envío en vuelo y bloquea nuevos envíos después de un recibo confirmado. Si falta confirmación, el reintento conserva requestId. Las respuestas tardías de un intento anterior no sustituyen una petición posterior. No se presume éxito por un timeout ni por un clic.

Lobby comprueba participante, partida e identificador en la respuesta. El servidor conserva la manipulación; F5 recupera su DTO privado y el control queda utilizado. No se guarda el secreto en un nuevo almacenamiento local ni se envía automáticamente otra manipulación al reconectar.

## Privacidad

El estado de capacidad vive en un useState privado de Lobby y se pasa a la ficha propia; no se añade al GameState compartido de vistas, al historial común o a las tarjetas ajenas. El adaptador solo acepta el evento si participantId coincide con la credencial actual, y el componente comprueba además gameId y rol autorizado. Desconectar borra ese estado; desmontar retira el listener exacto.

El único cambio de servidor añade el propietario al DTO privado ya existente para esa comprobación. El servidor sigue enviándolo exclusivamente a Botones. Médico y otros roles no reciben indicador de contaminación, muestras, usos fallidos, probabilidad ni cumplimiento ajeno. La capacidad privada se filtra también al renderizar el final.

Las pruebas verifican tanto la ausencia en el HTML de los otros roles como los mensajes reales recibidos por sus sockets. La protección no depende de CSS.

## Muerte inesperada, historial y variantes

MedicalDeathNotices representa exclusivamente los registros de medical.deaths ya confirmados por el servidor. Muestra el nombre, el fallecimiento después del tratamiento y la incertidumbre sobre la causa. No deduce una muerte de salud baja, de una restauración cero ni de un tratamiento aislado.

Se reutilizan las tres frases dramáticas de 10F.1. El servidor ya selecciona y almacena la variante; el cliente no vuelve a sortearla. F5 conserva el mismo texto. El aviso es un panel sin modal y no bloquea acciones.

El identificador estable combina partida, ronda y paciente. Tanto el aviso como el historial deduplican registros repetidos. Recibir otra instantánea reemplaza el estado, sin encolar avisos ni generar otro historial. El panel visible y el registro histórico plegado sirven para consulta; no son dos notificaciones emergentes.

El historial común solo registra fallecimiento y narración incierta. El resultado final utiliza además la narración pública que ya produce el servidor. No se publica autoría, veneno, estado pendiente, probabilidad ni tiradas. La confirmación de objetivo permanece en el canal y la sección privados de Botones.

## Médico y relevo del anfitrión

Dar Botiquín conserva su operación y sus autorizaciones. No se han añadido advertencias sobre sabotaje a la ficha del Médico. Los tratamientos posteriores y el consumo especial del NPC final siguen las reglas probadas de 10F.1; no hay tiradas nuevas en el cliente.

La cabecera muestra ahora «Anfitrión: nombre». Los permisos de apertura y avance se calculan con creatorId del room:updated autoritativo. Si el anfitrión fallece, la etiqueta y los controles se actualizan; el anterior no puede avanzar. La prueba con F5 confirma que se conserva el sucesor y que no se vuelve a sortear. El motor de sucesión no se ha modificado.

## Pruebas

- Suite completa de Vitest: 763 pruebas aprobadas en 62 archivos; base anterior 740 en 60.
- TypeScript: correcto en shared, server y web.
- Compilación: correcta en los tres paquetes, incluida producción Vite.
- git diff --check: correcto.
- docs/: sin cambios.

Las 23 pruebas nuevas cubren los cuatro roles, disponibilidad y rechazo por existencias, desconexión, propietario/partida incorrectos, confirmaciones privadas, objetivo, cierre sin víctima, variantes persistidas, mensajes e historial únicos, clics repetidos, timeout y reintento, respuestas tardías, listener único y relevo visible.

La integración utiliza cuatro sockets reales, bindGameSocket y el reducer de la aplicación. Ejecuta una manipulación autenticada sin cambiar inventario ni consumir RNG; un tratamiento con tirada fallida; otro con muerte del anfitrión; estado privado cumplido; mensajes públicos sin causa secreta; F5 de Botones y del sucesor; aislamiento de otra sala; y las seis rondas hasta el resultado final. Se inspeccionan los datos enviados y el HTML de cada sesión.

Las pruebas anteriores conservan la validación del umbral 25 %, una única muerte, rechazos sin tirada, medicamentos agotados sin víctima, tratamientos posteriores y consumo médico de NPC sin riesgo de este sabotaje.

## Verificación visual

Edge sin ventana comprobó Botones, Médico y muerte inesperada a 1440, 900, 390 y 320 px: doce combinaciones, sin desbordamiento horizontal, un reloj, cero modales, ficha sin acordeón y botones de recursos alineados por fila. La capacidad no ocupa la columna de la votación en escritorio; en móvil aparece después de las acciones en el flujo normal.

Se han revisado capturas de escritorio y móvil. Son fixtures React con el CSS real, complementados por la integración de sockets; no equivalen a una partida manual completa en cuatro navegadores con clics reales.

Artefactos locales en .cache/10f2/: bellhop-*.png, medic-*.png, death-*.png y layout-result.json. Se regeneran con la prueba medical-sabotage-ui.test.ts y node scripts/ui-check-10f2.mjs. No se publican capturas de información privada en ningún servicio.

## Prueba manual con cuatro navegadores

1. Abrir cuatro perfiles o sesiones independientes, reunir participantes e iniciar. Identificar los roles en sus fichas propias.
2. En Botones, consultar la capacidad y pulsar Manipular medicación. Comprobar confirmación privada, botón inutilizado y existencias médicas públicas iguales. Los otros perfiles no deben mostrar ningún aviso de manipulación. Dar Pack debe seguir disponible según su ventana.
3. Recargar Botones: debe conservar el uso y su estado pendiente. Probar también en una partida sin unidades médicas: el control no debe permitir actuar.
4. Esperar una lesión real de las reglas actuales. Por ejemplo, el paso por la galería de tuberías de ronda 3 aplica su efecto habitual. Médico podrá usar Dar Botiquín cuando el paciente sea elegible. No se han añadido botones de depuración ni cambios de salud para facilitar la prueba manual.
5. Una tirada fallida debe curar normalmente y mantener la capacidad pendiente. Una favorable debe mostrar la muerte y su frase incierta a todos; solo Botones verá Cumplido. Las probabilidades hacen que una partida pueda terminar sin víctima: ese resultado es correcto.
6. Recargar después del fallecimiento: misma narración, un aviso y un registro histórico, sin reutilizar la capacidad. Revisar también tratamientos posteriores autorizados.
7. Si fallece el anfitrión, comprobar la nueva etiqueta y controles en los cuatro perfiles. Recargar al sucesor y verificar que el anterior no puede avanzar. La prueba automatizada fuerza este escenario mediante RNG inyectado, sin modificar la probabilidad del producto.
8. Terminar las seis rondas y comparar el resultado común y los objetivos privados. Comprobar escritorio y móvil, desplazamiento y reloj visible.

## Limitaciones y cuestiones pendientes

No se han detectado nuevas reglas pendientes para 10F.2. Persisten las limitaciones anteriores del servidor en memoria: F5 recupera mientras la instancia siga activa; reiniciarla no conserva partidas. Si se pierde una respuesta, se muestra incertidumbre y se permite reintentar el mismo recibo o reconectar, sin anunciar un éxito inventado.

Las contradicciones técnicas y bloqueos excepcionales documentados en 10F.1 no se alteran en esta fase. No se avanza a 10C.2 ni a otra fase.

Trabajo terminado y detenido para revisión del usuario.