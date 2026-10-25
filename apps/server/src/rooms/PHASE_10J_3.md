# Fase 10J.3 — OpenAI opcional para supervivientes

## Implementación

Adaptador de servidor mediante `fetch` nativo y Responses API, con JSON Schema estricto y validación local. Se conserva el adaptador determinista y **demo sigue siendo el modo predeterminado**. No se instala SDK ni se realizan llamadas reales durante la implementación o las pruebas.

Archivos creados: `survivor-openai.ts`, `survivor-openai.test.ts` y este informe. Modificados: `manager.ts`, `survivor-agent.socket.test.ts`, `apps/server/src/config.ts`, `apps/server/src/index.ts` y `.env.example`.

## Configuración privada del servidor

| Variable | Valor inicial / finalidad |
|---|---|
| `NPC_AI_MODE` | `demo`; permite `openai` explícitamente |
| `OPENAI_API_KEY` | Vacía en el ejemplo; nunca se versiona una clave real |
| `NPC_AI_MODEL` | Sin modelo implícito; obligatorio en modo OpenAI, compatible con Responses y Structured Outputs |
| `NPC_AI_TIMEOUT_MS` | 2500 ms; rango 100–4000, inferior al control de vigencia de cinco segundos |
| `NPC_AI_MAX_CALLS` | 15 por partida; rango 0–15. Cero utiliza siempre demostración |

En modo OpenAI, clave y modelo ausentes producen un error de configuración sin imprimir sus valores. No se usan variables `VITE_*`. La entrada de producción crea un adaptador por partida: el presupuesto no se comparte entre salas ni se reinicia al pulsar F5.

## Generación y seguridad

El prompt separa identidad, hotel, estado físico, objetivo persuasivo, emoción, tiempos públicos, argumentos propios anteriores, restricciones y formato. Solo serializa una lista explícita de campos autorizados; excluye identificadores internos, información de jugadores, conversación humana y secretos. El modelo interpreta al superviviente, no a un asistente técnico.

Se solicitan mensajes de hasta 300 caracteres, sin herramientas ni capacidad de ejecutar acciones. Se comprueban estructura, longitud, contenido reservado, repeticiones y contradicciones básicas de movilidad; también se rechazan referencias a recursos, rutas ocultas o lesiones no registradas. Las instrucciones y controles conservadores reducen las invenciones, aunque no constituyen una prueba semántica exhaustiva de cualquier texto posible de un modelo real.

Se mantiene intacta la programación 0/20/40 y 0/15. Las peticiones son asíncronas, no detienen la votación y no tienen reintentos automáticos. Ante error HTTP, negativa, JSON inválido, respuesta incompleta, contenido no válido, presupuesto agotado o timeout se devuelve el argumento de demostración correspondiente. El timeout aborta la petición y resuelve el respaldo incluso si el transporte simulado ignora la señal.

El ciclo existente vuelve a comprobar encuentro, ronda, intento y plazo antes de publicar. Un resultado tardío, incluido un respaldo, no puede hablar tras cerrar la votación. El historial y la idempotencia del agente evitan duplicados por snapshots o reconexión.

Cada adaptador mantiene un registro interno acotado del origen `openai`/`demonstration` y motivo genérico. No guarda claves, prompts, texto generado ni cuerpos de error en ese registro. No se añaden credenciales o metadatos del proveedor al chat o sus contratos públicos.

## Validación

- Pruebas específicas del adaptador y agente: 49 aprobadas.
- Cuatro clientes Socket.IO en modos demo y OpenAI simulado: dos variantes aprobadas; F5, orden, presupuesto humano independiente, aislamiento y privacidad.
- Validación general única: **969 pruebas aprobadas, cero fallos, 79 archivos**.
- TypeScript, compilación de producción y `git diff --check`: correctos.
- Todas las respuestas del proveedor se simulan mediante inyección de `fetch`; ninguna prueba llama a OpenAI. No se ha utilizado clave real ni se ha comprobado disponibilidad de un modelo en una cuenta real.

Referencia concreta consultada mediante la habilidad OpenAI Docs: [Structured Outputs con Responses API](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Uso y límites

Sin configuración adicional, el juego funciona exactamente en demo. Para una futura prueba real autorizada, configurar las variables privadas en el entorno del servidor y reiniciarlo; no escribir claves en código, archivos versionados ni formularios del navegador. Esa prueba real y la valoración de la calidad de los argumentos quedan pendientes de una activación explícita, sin impedir el uso del modo demo.

Sin cambios en reglas, costes, probabilidades, objetivos, votaciones, temporizadores o interfaz. Sin dependencias nuevas, cambios en `docs/`, commit ni push.
