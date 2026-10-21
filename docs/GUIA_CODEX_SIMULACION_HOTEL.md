# Simulación Hotel — Guía de arquitectura y prompts para Codex

**Estado:** arquitectura elegida por la autora; los modelos, nombres de carpetas y detalles de implementación indicados aquí son propuestas para revisión. **No constituye una orden para modificar archivos.**

## 1. Arquitectura elegida

- Frontend: React + TypeScript + Vite.
- Backend: Node.js + TypeScript + Fastify.
- Multijugador: Socket.IO; el servidor es autoridad sobre votos, plazos y estado de la partida.
- Persistencia: PostgreSQL + Prisma.
- Pruebas: Vitest.
- IA: módulo del backend que usa una API de modelo con entradas/salidas estructuradas, pero no decide unilateralmente las reglas ni altera variables fuera de acciones validadas.
- Monorepositorio: `apps/web`, `apps/server`, `packages/shared`, `docs`, `tests` (estructura propuesta). Evitar infraestructura innecesaria en la primera versión.
- Proteger información privada en el backend: nunca enviarla a un cliente no autorizado. La UI no es una barrera de seguridad.

## 2. Contrato de trabajo con Codex

1. Trabajar exclusivamente dentro del repositorio **Everest-V3-HotelSurvival**. No modificar otros repositorios, archivos personales ni configuración global del ordenador.
2. Antes de cualquier escritura: inspeccionar, indicar archivos que propone crear/modificar, explicar su propósito, identificar las reglas sin definir y **esperar aprobación**.
3. Prioridad: documentos del profesor (requisitos), últimas decisiones confirmadas de la autora (mecánicas), documento original (ideas todavía vigentes). Nunca transformar una propuesta en una regla aprobada.
4. No inventar rondas, recursos, porcentajes, condiciones de victoria, penalizaciones, rutas, temporizadores ni información privada. Marcar `PENDIENTE` en las cuestiones que lo estén.
5. Una fase por tarea. Al terminar, explicar qué se cambió, por qué, cómo probarlo, qué pruebas se ejecutaron y qué preguntas quedan abiertas.
6. No hacer `git commit`, `git push`, instalaciones globales, despliegues, escrituras externas ni manejar claves reales sin permiso específico.
7. Mantener `.env.example` sin secretos y `.gitignore` apropiado; no almacenar claves ni credenciales en repositorio o logs.
8. Pedir confirmación antes de modificar archivos existentes o instalar dependencias. Usar TypeScript estricto y pruebas deterministas del motor.

## 3. Reglas de juego aprobadas: referencia de implementación

**Formato**
- Cuatro jugadores humanos al empezar, exactamente uno por rol: Mantenimiento, Médico, Arquitecto/Ingeniero y Botones. Cuatro rondas.
- Si muere un personaje, la partida continúa, no vota y su información privada deja de estar disponible; los demás pueden recuperar sus objetos. Cualquier superviviente puede usar la palanca recuperada, aunque no herede los conocimientos especializados de mantenimiento.
- Mayoría estricta sobre los jugadores vivos para votaciones colectivas: 4 vivos => 3 votos, 3 => 2, 2 => 2, 1 => 1. Temporizadores permanecen iguales tras una muerte.

**Estado y recursos**
- Cada personaje humano inicia con 100/100 de salud y 100/100 de energía. Salud 0 = fallecimiento. Salud/energía no superan 100.
- Si un personaje termina una acción con 0 de energía, esa acción se completa. No puede iniciar otra acción que requiera energía hasta recuperarla; no se ha aprobado energía negativa.
- Inventario compartido inicial: 8 packs de agua+comida; cada pack restaura 25 de energía a una sola persona. 4 unidades médicas iniciales; +2 si se alcanza la sala de conferencias médicas de la ruta cortafuegos.
- Cada unidad médica restaura +20 salud a un personaje humano, máximo 100. Se permite **máximo 1 unidad médica por participante humano y ronda**, antes o después del desplazamiento.
- Médico propone curación para un personaje humano; votan los otros tres jugadores cuando los cuatro están vivos, y hacen falta 2 votos favorables. Votación médica de 20 s, sin repetición; si no aprueban, no se gasta. **PENDIENTE:** adaptación de estas propuestas si el médico fallece o hay menos votantes vivos.
- Un NPC incapaz de caminar puede recibir 1 unidad médica como una tercera opción de la votación de rescate: pasará a caminar con ayuda, y el esfuerzo de rescate por participante disminuye de 40 a 25. No se ofrece esa intervención si el NPC ya camina con ayuda. **PENDIENTE:** relación exacta entre límite de unidades por participante humano y uso en NPC.
- Coste de esfuerzo por nivel: ligero -10, moderado -20, intenso -30, extremo -40 de energía por jugador. Excepciones explícitas existentes: ronda 1 travesía -15, rescate de NPC que camina con ayuda -25 y NPC transportado -40.

**Peligros**
- Bajo (estabilidad 76-100%): 10% de accidente, -5 salud.
- Moderado (51-75%): 20%, -10 salud.
- Alto (26-50%): 35%, -20 salud.
- Extremo (0-25%): 50%, -30 salud.
- Si ocurre un accidente de ruta, se seleccionan **exactamente 2 participantes humanos distintos de entre los 4** aleatoriamente y ambos reciben el daño total de su nivel. **PENDIENTE:** cómo manejar accidentes cuando solo hay uno o dos personajes vivos. No aplicar daño a todos como regla general.
- La exposición a humo/gas intenso es independiente de los accidentes y causa -20 salud garantizada a cada humano que atraviesa la ruta. También existe exposición moderada -10 salud cuando esté definida. Las áreas bloqueadas son intransitables.

**Ronda 1 — El despertar**
- Solo una ruta. Salir de habitaciones -15 energía por jugador. Un NPC que puede caminar con ayuda, rescate opcional -25 energía por jugador.
- Si fracasa el mecanismo de votación, micro-réplica y escombros sobre el grupo: -10 salud. No inventar rutas alternativas para esta ronda.

**Ronda 2 — Pasillo principal**
- Pasillo inestable: peligro Alto, esfuerzo Ligero -10 energía.
- Conductos de ventilación: peligro real Bajo (oculto a todos los jugadores, incluso arquitecto), esfuerzo Moderado -20 energía. Mantenimiento conoce esta ruta, no su nivel interno de seguridad.
- Despeje/apuntalamiento: peligro Moderado, esfuerzo Intenso -30 energía. Disponible al estar arquitecto y mantenimiento en juego; arquitecto indica refuerzos, mantenimiento ejecuta.
- Un NPC camina con ayuda; rescate opcional -25 energía por jugador.
- Si no hay acuerdo en votaciones normales, inacción -10 salud, micro-réplica y avance por ruta de mayor inestabilidad aplicando costes/riesgos normales; verificar tratamiento de opciones bloqueadas antes de implementar.

**Ronda 3 — Obstáculo técnico**
- Puerta cortafuegos: peligro Moderado (20% accidente, -10 salud a las 2 víctimas), esfuerzo Moderado -20 energía. Se abre con palanca de mantenimiento; al cruzar, una réplica deja la palanca atrás SIEMPRE y ese suceso no daña la salud. La tirada general de accidente se realiza INDEPENDIENTEMENTE. A través de la puerta se llega a la sala donde el Médico asistía a una conferencia médica: **es información privada del Médico**, no de mantenimiento. En la sala hay +2 unidades médicas intactas garantizadas.
- Galería de tuberías y calderas: peligro Extremo (50% accidente, -30 salud por víctima), esfuerzo Ligero -10 energía; gas/humo intenso -20 salud garantizada para todos, independiente del accidente.
- Escombros metálicos y desvío a almacén: peligro Moderado (20% accidente), esfuerzo Intenso -30 energía. El Botones conoce la ubicación del almacén pero NO la cantidad de packs. Al alcanzarlo: 70% +4 packs en total o 30% +8 packs en total (nunca 4+8). Sin nuevos NPC.

**Ronda 4 — Evacuación**
- Puerta giratoria atascada: peligro Bajo (10% accidente, -5 salud por víctima), esfuerzo Moderado -20 energía. Requiere palanca, que puede perderse en R3.
- «Grieta en el muro exterior del acceso de carga y descarga»: UNA sola ruta, peligro Extremo (50% accidente, -30 salud por víctima), esfuerzo Ligero -10 energía.
- NPC opcional en vestíbulo: 50% no aparece; 25% aparece y camina con ayuda; 25% aparece y necesita transporte. Ha sufrido golpe en cabeza, está mareado y confuso. Rescatarlo/abandonarlo es votación **independiente** de la ruta; en el segundo caso puede incluir opción de botiquín para pasar a caminar con ayuda.
- Rescate NPC (si existe): primera votación 60 s. Si no hay consenso: mostrar literalmente «El superviviente parece debilitarse a cada segundo que pasa». Segunda votación 30 s. Si tampoco hay mayoría, NPC fallece definitivamente y no se puede rescatar; no hay tercera votación ni derrumbe por esta votación.
- Elección de ruta: primera votación 60 s. Si falla, derrumbe parcial, -5 salud a cada humano y +5 al coste energético de la ruta elegida, seguido de votación extraordinaria 30 s. Si falla también, la puerta giratoria se derrumba y el grupo debe atravesar OBLIGATORIAMENTE la grieta. No hay derrota automática solo por este fallo.

**Votaciones y privacidad**
- Generales: mayoría estricta de personajes vivos; normalmente primera de 60 s y segunda de 30 s salvo reglas específicas por ronda. Con cuatro participantes 3 votos requeridos.
- Interfaz con salas, rol privado, panel de situación, votaciones, temporizadores, chat y resultados. Lo informado a un personaje fallecido no debe poder consultarse mediante su sesión; **PENDIENTE:** información ya revelada en chat, modo espectador.

**Pendientes NO resueltos que hay que documentar y no inventar**
- Lógica si fallece médico (proposición médica) y adaptación de votaciones médicas con menos vivos.
- Persistencia de mensajes de chat compartidos después de muerte; modo espectador.
- Reglas de un accidente con menos de dos humanos vivos.
- Orden exacto y posible encadenamiento de varias acciones médicas y de rescate en la ronda.
- Costes, desbloqueos y tratamiento de una ruta que requiere acciones especializadas cuando el especialista ha muerto.
- Recuperación/reparto de packs en momentos concretos, consumo médico para NPC, condiciones de victoria y puntuación individual pormenorizadas.
- Verificar nomenclatura de niveles de esfuerzo en excepciones numéricas R1 y rescates.
- Alcance exacto del agente de IA, comportamiento ante desconexiones y esquema de evaluación.

## 4. Esquema de datos inicial (PROPUESTA, no definitivo)

- `GameSession` / Partida: id, código de sala, fase, ronda, estado, timestamps, versión/semilla aleatoria, recursos compartidos.
- `PlayerSeat` / Participación humana: identidad dentro de la partida, token de reconexión, rol asignado, conectado, vinculación a estado de personaje. Separar conexión de estado vivo/muerto.
- `CharacterState`: salud, energía, vivo, usos médicos de la ronda, información específica.
- `RoleDefinition` y vistas `RoleKnowledge`: privilegios de información por rol y datos autorizados en cada ronda. No guardar secretos del juego en payloads públicos.
- `RouteDefinition`: ruta de catálogo inmutable, peligro, coste energético, requisitos y consecuencias; ocultar internamente peligros que los jugadores no deben ver.
- `NPCState`: aparición, movilidad, salud/estado, rescate y desenlace.
- `Inventory` y `ResourceTransaction`: packs, suministros médicos, palanca y cambios auditables.
- `VoteSession`, `VoteOption`, `Vote`: decisión, electorado, votos, cierre en tiempo de servidor, resultado.
- `GameEvent` / event log: acciones, accidentes, víctimas, consumos, elecciones, mensajes de sistema, eventos de IA y desenlace.
- `GameResult`: victoria/derrota, supervivientes, NPC rescatados, objetivos, evidencias para evaluación.

Nota técnica: las definiciones de escenarios podrían vivir en archivos de datos TypeScript/JSON versionados, y la base de datos almacenar instancias y cambios. Decidirlo expresamente antes de implementar. Las funciones del motor deberían poder probarse sin UI ni DB (entradas/salidas deterministas, aleatoriedad inyectada).

## 5. Ciclo de vida sugerido (PROPUESTA)

`LOBBY (4 plazas)` → `ROLE_BRIEFING` → `ROUND_READY` → `DECISION/VOTE` → `RESOLUTION` → `ROUND_SUMMARY` → siguiente ronda → `GAME_RESULT`.

En cada ronda hay subfases opcionales (`NPC_RESCUE_VOTE`, `MEDICAL_PROPOSAL`, `ROUTE_VOTE`, `ACCIDENT_RESOLUTION`). No codificar estados o transiciones no confirmados; redactar primero matriz completa de fases/transiciones y casos límite para revisión.

## 6. Prompts para Codex, en orden (copiar uno cada vez)

### PROMPT 0 — Auditoría SOLO LECTURA: USAR AHORA

```text
Estamos en el proyecto Everest-V3-HotelSurvival, una simulación web multijugador de un hotel tras un terremoto. Tu alcance está limitado EXCLUSIVAMENTE a este repositorio.

FASE 0: SOLO LECTURA. No crees, edites ni borres archivos, no instales dependencias, no ejecutes migraciones y no hagas commit, push ni despliegues. No accedas a archivos personales ni otros proyectos.

1. Identifica la raíz real del repositorio y su estado con comandos de lectura, incluyendo árbol de archivos relevante, package.json si existe, lockfiles, .gitignore, README y documentación en docs/.
2. Identifica qué hay ya implementado, qué falta y qué archivos deben conservarse sin alteraciones.
3. Comprueba si existen el documento maestro de diseño y el enunciado del profesor. Si no están, indícamelo: no puedes conocer por ti mismo las reglas acordadas con ChatGPT ni inventarlas.
4. Compara lo observado con esta arquitectura APROBADA: React+TypeScript+Vite (web), Node.js+TypeScript+Fastify (server), Socket.IO, PostgreSQL+Prisma, Vitest, IA encapsulada en backend, estructura tipo monorepo. No implementes nada todavía.
5. Propón los siguientes pasos en bloques pequeños, archivos que tocarías, riesgos y decisiones que debo confirmar.

Dame un informe en español, claro para alguien que está aprendiendo. Espera mi aprobación para realizar la fase siguiente.
```

### PROMPT 1 — Contrato de documentación y modelo: DESPUÉS DE REVISAR LA AUDITORÍA

```text
FASE 1: propuesta de diseño técnico, NO implementación. Trabaja solo en Everest-V3-HotelSurvival.

Lee los documentos de reglas del proyecto que te haya proporcionado (especialmente el resumen actualizado de decisiones y el documento original) y el informe de auditoría anterior. Si alguno no está disponible, DETENTE y solicita el documento; no infieras reglas del juego.

Necesito que diseñes, en tu respuesta y SIN modificar archivos todavía:
A) diagrama lógico textual de frontend, backend, BD, Socket.IO y agente de IA;
B) entidades y relaciones para Partida, Participante, EstadoPersonaje, Rol, Ruta, SupervivienteNPC, Recurso/Inventario, Votacion, Voto, Evento, Resultado, con campos propuestos y responsabilidades;
C) ciclo de vida de una partida y estados de votación (incluidas R4, votaciones médicas y muertes);
D) separación entre contenido público del jugador, información privada por rol y valores internos del motor;
E) matriz de reglas aprobadas vs pendientes que bloquearían la implementación;
F) lista EXACTA de documentos y archivos que propondrías crear, con su propósito.

No inventes reglas, no escribas código, no instales paquetes. Explica las decisiones técnicas de forma comprensible y espera que apruebe el modelo antes de crear documentación.
```

### PROMPT 2 — Crear documentación técnica, solo tras aprobar el modelo

```text
FASE 2: documentación aprobada. Lee el diseño técnico que ya he aprobado y los documentos fuente. Antes de escribir, enumera rutas exactas de archivos que crearás/modificarás y espera mi aprobación.

Después de mi autorización, crea exclusivamente dentro del repositorio una documentación breve y mantenible, por ejemplo: docs/REGLAS_APROBADAS.md, docs/PENDIENTES.md, docs/ARQUITECTURA.md y docs/MODELO_DATOS.md. Añade AGENTS.md únicamente si te autorizo y si no existe una versión que debas preservar.

Distingue literalmente REQUISITO DEL PROFESOR, DECISIÓN APROBADA y PENDIENTE/PROPUESTA. No supongas que el documento original refleja las últimas decisiones. No cambies código, dependencias ni configuraciones. Tras escribir, informa de los cambios y revisa inconsistencias.
```

### PROMPT 3 — Esqueleto técnico (primera programación)

```text
FASE 3: scaffolding mínimo. Trabaja solo en Everest-V3-HotelSurvival. Lee AGENTS.md, docs/ARQUITECTURA.md y docs/MODELO_DATOS.md si existen, y el estado actual de la rama.

Objetivo de esta fase: arrancar un frontend React + TypeScript + Vite y un backend TypeScript + Node.js + Fastify organizados en el mismo repositorio, con paquete de tipos compartidos; preparar configuración local, lint/format si procede, .gitignore, .env.example y scripts de ejecución. NO implementar todavía las rondas, la IA, PostgreSQL, votaciones ni Socket.IO a menos que lo autorice expresamente.

Antes de escribir o instalar dependencias, presenta: (1) comprobación de compatibilidad con la versión de Node instalada; (2) gestor de paquetes propuesto y justificación; (3) archivos precisos que crearás; (4) comandos que necesitas ejecutar. Espera mi autorización.

Al terminar, demuestra por separado que web y server arrancan, explica cómo reproducirlo desde VS Code, ejecuta comprobaciones disponibles y detente. No toques rutas fuera del repo ni hagas git commit/push.
```

### PROMPT 4 — Motor de reglas en TypeScript, con pruebas (tras aprobar modelo)

```text
FASE 4: implementar ÚNICAMENTE el núcleo puro y comprobable del motor. Lee la documentación de reglas más reciente y el código existente. Prepara un plan de funciones y pruebas y espera mi aprobación antes de editar.

Necesito modelos/tipos e implementación testeable de: salud y energía (0 permitido al completar la acción, nunca negativos), consumo de packs, inventario, curación, mayorías basadas en vivos, costes por ruta, probabilidades, selección aleatoria SIN repetición de exactamente dos víctimas cuando sea aplicable, eventos especiales de rutas y obtención de packs 70%/30%. Usa generador de aleatoriedad inyectable/semilla para reproducir pruebas. No inventes las reglas todavía pendientes; marca interfaces TODO y explícame qué bloquean.

Primero tests de ejemplos aprobados y casos límite, luego implementación mínima. No dependas de React, Socket.IO, PostgreSQL ni APIs de IA para ejecutar los tests del motor.

Detente al terminar esta fase, informa de archivos, comandos y resultados observados. Sin commit/push/despliegue.
```

### PROMPT 5 — Sala de cuatro jugadores y tiempo real

```text
FASE 5: multijugador básico con Socket.IO sobre backend existente. Lee los documentos relevantes, las reglas de seguridad de información privada y los tests existentes. Propón archivos y eventos Socket.IO y espera mi aprobación antes de escribir.

Necesito crear sala con código, permitir cuatro conexiones humanas, asignar roles únicos, reflejar conectados/desconectados sin confundir desconexión con muerte, mostrar panel privado autorizado por rol, sincronizar propuestas/votos con reloj del servidor y prevenir votos duplicados. La mayoría depende solo de personajes vivos. Implementa una sesión con alcance mínimo antes de extenderla a las cuatro rondas.

Nunca envíes al cliente datos de peligro oculto ni información de otros roles sin permiso. No asumir que ocultar datos en React los protege. Añade tests apropiados para permisos y sincronización. No implementar IA todavía. Detente y explica pruebas y resultados.
```

### PROMPT 6 — Primera ronda jugable de extremo a extremo

```text
FASE 6: vertical slice de la RONDA 1, usando el motor y la sala multijugador ya creados. Lee reglas aprobadas y decisiones pendientes. Primero explica flujo exacto, pantallas mínimas, opciones de voto, transiciones, y cómo evitarás inventar mecánicas.

Tras mi aprobación, implementar únicamente la ronda 1 con ruta única, coste -15 energía, decisión de rescate opcional de NPC caminante con ayuda (-25 por jugador), votos y penalización de inacción ya aprobada, estado persistido, resumen visible y pruebas de integración. No crear rutas alternativas en ronda 1, no adelantar las rondas 2-4, no añadir eventos aleatorios no aprobados ni integrar IA aún.

Mostrar evidencia de que cuatro navegadores pueden jugar la ronda completa; si no puedes verificar un aspecto, dilo expresamente. Detente tras la fase.
```

### PROMPT 7 — Ampliación de rondas y funcionalidad de IA (DOS ETAPAS DISTINTAS)

```text
PREPARACIÓN, SOLO LECTURA. Revisa el MVP de la ronda 1 y la documentación del diseño aprobada. Propón fases separadas para (A) rondas 2-4 y sus eventos; (B) integración de IA con una función REAL definida y aprobada, prompting estructurado y validación estricta de resultados; (C) pantalla de resultados y pruebas de partidas completas de 10-15 minutos.

No implementes ninguna de estas fases ni selecciones unilateralmente la función del agente. Primero presenta dependencias, riesgos, pruebas, archivos afectados y asuntos pendientes; espera que te indique cuál implementar.
```

### PROMPT 8 — Verificación y revisión independiente

```text
Revisa SOLO el trabajo de la fase recién terminada en este repositorio. Comprueba comportamiento frente a requisitos, seguridad de información por rol, no regresiones, reproducibilidad de instalación, tests y posibles errores del motor. Ejecuta únicamente verificaciones autorizadas.

Entrega primero los errores reales por gravedad y archivo, después pruebas y comandos realmente ejecutados (no afirmes pruebas que no hiciste), cambios recomendados, y preguntas pendientes. No modifiques archivos hasta recibir aprobación; no hagas commit, push ni despliegue.
```

## 7. Secuencia de uso recomendada

1. Abre la raíz correcta del repo en Codex; copia el **PROMPT 0** ahora.
2. Revisa el informe. Asegura que Codex dispone del **documento maestro actualizado** o coloca una versión de este resumen en `docs/` con tu autorización.
3. Ejecuta el **PROMPT 1**. Revisa el modelo de datos y estados aquí, antes de implementarlo.
4. Una vez aprobado, ejecuta **PROMPT 2** (documentación) y después **PROMPT 3** (esqueleto).
5. Solo entonces solicita motor de reglas, multijugador, primera ronda y expansión posterior. Usa **PROMPT 8** entre fases si necesitas una revisión.

**No ejecutar todo en un solo mensaje.** Cada prompt tiene un alcance distinto y una aprobación explícita antes de escrituras.
