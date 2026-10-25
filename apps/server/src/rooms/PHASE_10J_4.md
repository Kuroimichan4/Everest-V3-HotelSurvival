# Fase 10J.4 — Gemini opcional para supervivientes NPC

## Cambios

Se sustituye el adaptador OpenAI por `survivor-gemini.ts` y sus pruebas `survivor-gemini.test.ts`. Se actualizan las importaciones de `apps/server/src/config.ts`, `apps/server/src/index.ts` y la integración `survivor-agent.socket.test.ts`, además de `.env.example`. Se eliminan los módulos antiguos y sus dos artefactos compilados obsoletos. Los informes anteriores se conservan como registro histórico, no como instrucciones vigentes.

Se utiliza `fetch` nativo del servidor, sin SDK ni dependencias nuevas, contra `https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent`. La clave se envía mediante `x-goog-api-key`, nunca en la URL. El cuerpo incorpora instrucciones de personaje, contexto autorizado y JSON Schema en `generationConfig.responseFormat.text`, conforme al ejemplo REST oficial.

La validación local y la arquitectura del agente se conservan: mismos encuentros, programación 0/20/40 y 0/15, descarte de mensajes tardíos, idempotencia, privacidad, presupuesto por partida, timeout y respaldo de demostración. No se modifica el chat, el motor, los textos dramáticos ni los reinicios. No se envían conversación humana, datos privados de jugadores ni identificadores internos al modelo. No se habilitan herramientas o acciones.

Se aceptan únicamente candidatos de texto de rol `model`, terminados con `STOP`, sin bloqueo de seguridad. Bloqueos, salidas incompletas, llamadas a funciones, JSON incorrecto y contenido inválido producen un único respaldo determinista. Las partes de pensamiento no se publican. No hay reintentos ni cambio automático a otro modelo o nivel de pago.

## Configuración

```dotenv
SURVIVOR_AI_MODE=demo
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
SURVIVOR_AI_TIMEOUT_MS=2500
SURVIVOR_AI_MAX_CALLS=15
```

Solo se admiten los modos `demo` y `gemini`. Demo es el valor predeterminado, incluso si hay una clave configurada. El timeout conserva el rango 100–4000 ms y el presupuesto 0–15 llamadas por partida. El modelo es configurable y su identificador se valida para impedir rutas o URLs arbitrarias. Las antiguas variables `NPC_AI_*` y `OPENAI_API_KEY` ya no se utilizan.

No se ha editado el `.env` local, activado Gemini ni utilizado ninguna clave real.

## Activación futura en el nivel gratuito — no ejecutada

1. Entrar en [Google AI Studio, API Keys](https://aistudio.google.com/api-keys). Crear o seleccionar un proyecto y generar una clave para Gemini API. Si es una cuenta nueva, Google puede crear el proyecto al aceptar las condiciones; si es un proyecto existente, puede ser necesario importarlo en Projects.
2. Comprobar en Projects la columna **Billing Tier**: debe indicar **Free** para usar el nivel gratuito. No seleccionar «Set up billing», no vincular facturación ni comprar créditos para esta prueba gratuita. La clave pertenece a un proyecto; no existe una cadena de clave especial que garantice gratuidad si el proyecto está en un nivel de pago.
3. Tras aprobar esta fase, editar el archivo privado `.env` de la raíz del repositorio. Si no existe, crearlo a partir de `.env.example`; si existe, conservar sus demás valores. Usar:

```dotenv
SURVIVOR_AI_MODE=gemini
GEMINI_API_KEY=REEMPLAZAR_LOCALMENTE_POR_TU_CLAVE
GEMINI_MODEL=gemini-3.5-flash-lite
SURVIVOR_AI_TIMEOUT_MS=2500
SURVIVOR_AI_MAX_CALLS=15
```

4. Guardar la clave real únicamente en ese archivo privado o en el entorno del servidor. No usar `.env.example`, variables `VITE_*`, React, el chat ni archivos versionados. Si las mismas variables están definidas en el entorno de Windows, comprobar que sus valores corresponden al modo deseado: tienen precedencia sobre la carga del archivo local.
5. Detener el servidor existente y, desde la raíz, ejecutar `npm.cmd run dev:server` en una terminal con el Node del proyecto. El frontend conserva su flujo habitual. Al comenzar una nueva partida se crea un adaptador nuevo con su presupuesto independiente. Activarlo puede enviar peticiones reales desde el primer encuentro NPC.
6. Para volver a la demostración, establecer `SURVIVOR_AI_MODE=demo` y reiniciar el servidor. Si hay error, cuota agotada o demora, el juego utiliza el respaldo de demostración sin bloquear la votación.

La documentación oficial consultada el 25/10/2026 publica [`gemini-3.5-flash-lite`](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) con salidas estructuradas y [entrada/salida gratuitas en Free Tier](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite). El acceso y las cuotas concretas dependen de la cuenta y del proyecto y deben comprobarse en AI Studio; no se ha probado una cuenta real. Google indica que el contenido del nivel gratuito puede utilizarse para mejorar sus productos. Solo se envía el contexto ficticio autorizado del NPC.

Referencias concretas: [REST generateContent y JSON estructurado](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [creación de claves](https://ai.google.dev/gemini-api/docs/api-key) y [nivel gratuito y facturación](https://ai.google.dev/gemini-api/docs/billing).

## Verificación

- Pruebas específicas iniciales del adaptador, agente y cuatro clientes: 51 aprobadas.
- Casos Gemini adicionales: modelo predeterminado/configurable, identificador inválido, candidatos vacíos o múltiples, bloqueo, salida truncada, funciones rechazadas, partes de pensamiento omitidas y JSON multipartes validado.
- Adaptador e integración Socket.IO ampliados: 35 pruebas aprobadas, con proveedor simulado.
- Validación general única: **986 pruebas aprobadas, cero fallos, 81 archivos**.
- TypeScript, compilación de producción y `git diff --check`: correctos.

Sin llamadas reales a Gemini u OpenAI, cambios en `docs/`, reglas, costes, objetivos, probabilidades o dependencias. Sin commit ni push. Gemini queda desactivado a la espera de revisión.
