# Fase 10K.1 — Narrativa final

## Recuperación y cierre

Antes de la interrupción ya estaban implementados el catálogo narrativo, las variantes deterministas, la narrativa colectiva del resultado, la narrativa privada del objetivo, el epílogo propio en la proyección autenticada y su presentación React con estilos. Se han conservado sin reescribirlos.

En esta continuación se han completado las pruebas específicas, ampliado la integración de cuatro clientes con comprobaciones de privacidad, generado las vistas de prueba y comprobado escritorio/móvil. No ha sido necesario cambiar el evaluador ni corregir la implementación guardada.

## Archivos de la fase

Implementación ya guardada:
- `apps/server/src/simulation/final-narrative.ts`: textos y selección determinista.
- `apps/server/src/simulation/final-result.ts`: valoración colectiva pública.
- `apps/server/src/simulation/objective-evidence.ts`: valoración privada según evaluación existente.
- `apps/server/src/rooms/manager.ts`: epílogo exclusivamente del destinatario autenticado.
- `packages/shared/src/index.ts`: contratos narrativos opcionales compatibles.
- `apps/web/src/FinalResults.tsx` y `styles.css`: título dramático, valoración colectiva, elogio/reproche y destino propio, manteniendo cifras y evidencias.

Completados ahora:
- Nuevo `apps/server/src/simulation/final-narrative.test.ts`.
- Ampliados `apps/web/src/FinalResults.test.ts` y `apps/server/src/rooms/game-final.socket.test.ts`.
- Nuevo `scripts/ui-check-10k1.mjs` y este informe.

## Categorías, coherencia y privacidad

Se distinguen todos/parcialmente evacuados, todos fallecidos y ausencia de evacuación confirmada sin presumir muerte; abandonos humanos; NPC evacuados, abandonados, fallecidos, rescates aprobados sin ejecutar y rescates sin llegada acreditada. Un NPC ausente o nunca encontrado no provoca reproches de abandono.

Cada rol tiene elogios para `fulfilled`, reproches para `unfulfilled` y una valoración prudente para `pending-evaluation`. Se usa exclusivamente el valor del evaluador existente. En particular, no se transforma en fracaso un estado pendiente de Mantenimiento o del Médico. No se exige recorrer las alternativas reveladas ni se penalizan rutas únicamente seleccionadas.

El epílogo distingue evacuado, fallecido, abandonado y activo sin salida confirmada. Nunca convierte abandono en muerte. Las críticas se refieren a decisiones de la ficción, sin insultar al jugador real.

La selección utiliza un hash del identificador estable de partida, participante cuando corresponde y categoría. Cada categoría tiene dos variantes. No consume RNG, no cambia recursos ni resultados y F5 conserva los textos.

La narrativa colectiva solo recibe el resultado público. Los textos de objetivo viajan por la evidencia privada existente; el epílogo propio se añade únicamente al proyectar el resultado para la sesión autenticada. React verifica la identidad del destinatario y del resultado. Las reflexiones oscuras de Botones no aparecen en los resultados públicos ni en los de otros roles. El Médico no recibe una explicación causal secreta de las muertes misteriosas. Se mantienen las restricciones de acceso ya existentes para personajes eliminados.

## Verificación final

- Pruebas específicas relacionadas: **70 aprobadas**.
- Única ejecución general en esta continuación: **943 pruebas aprobadas, cero fallos, 78 archivos**.
- TypeScript, compilación de producción y `git diff --check`: correctos.
- Cuatro clientes Socket.IO: valoración pública compartida, objetivos privados separados, epílogo del destinatario y recuperación estable después de F5. Se conservan las comprobaciones de RNG e invariancia del resultado.
- Edge sin interfaz: tres desenlaces a **1440, 900, 390 y 320 px**, doce combinaciones sin desbordamiento ni secciones duplicadas. Capturas y mediciones en `.cache/10k1/`. Son comprobaciones de vistas renderizadas; no sustituyen la revisión de una partida manual completa.

Para revisar visualmente: comprobar jerarquía del título y cifras, contraste y extensión de los párrafos, distinción entre muerte y abandono y textos propios de los cuatro roles. Recargar un final y comprobar que no cambian las variantes.

No queda implementación pendiente en esta fase; queda la revisión del usuario. Sin cambios de balance, objetivos, chat o agentes NPC, sin conexiones externas, dependencias nuevas ni cambios en `docs/`. Sin commit ni push, ni avance a otra fase.
