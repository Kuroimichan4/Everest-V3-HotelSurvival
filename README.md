# Everest-V3-HotelSurvival

Simulación web multijugador de liderazgo y gestión de crisis en un hotel parcialmente derrumbado tras un terremoto.

## Estado actual

La base técnica incluye frontend, backend, contratos compartidos, pruebas y configuración inicial de Prisma. Ya existe un motor básico de salud, energía y packs, además de salas de cuatro participantes con espera, inicio manual por el creador, asignación aleatoria de roles y reconexión. La pantalla mantiene las comprobaciones HTTP y Socket.IO. Las salas viven provisionalmente en memoria y se pierden al reiniciar el servidor. Todavía no hay rondas, votaciones, persistencia de partidas ni proveedor de IA.

Consulta [el motor básico](apps/server/src/simulation/README.md) y [las salas multijugador](apps/server/src/rooms/README.md), con instrucciones para probar cuatro sesiones independientes.

Los documentos originales de `docs/` se conservan íntegros. Las decisiones posteriores confirmadas por la autora prevalecen sobre las propuestas anteriores. Las últimas correcciones incluyen objetivos por rol ya definidos, accidentes sobre dos humanos vivos distintos (un único vivo sigue pendiente), tratamiento de NPC mediante la votación de rescate y revocación de información privada al fallecer. No se implementan esas mecánicas en esta fase; puntuación y casos pendientes requieren revisión.

## Requisitos

- Node.js 24 LTS, versión 24.11 o superior dentro de la rama 24.
- npm 11.
- No hace falta PostgreSQL para arrancar esta base ni ejecutar sus pruebas.

Desde VS Code abre **la raíz de este repositorio** y utiliza sus terminales integradas:

```powershell
node --version
npm.cmd --version
```

En Windows se usa `npm.cmd` para evitar depender de la política de ejecución de scripts de PowerShell. En otros sistemas utiliza `npm`.

Si se ha descargado Node portátil en este proyecto, puedes habilitarlo solo para la terminal actual:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;$env:Path"
```

Repite esa línea en cada terminal que necesite Node portátil. `.tools/` no se incluye en Git y no estará presente en un clon nuevo.

## Instalación local

Ejecuta una única instalación desde la raíz; npm enlaza los tres workspaces:

```powershell
npm.cmd ci
```

`package-lock.json` fija las versiones. Para cambios deliberados de dependencias se utiliza `npm.cmd install`. No se necesitan instalaciones globales. La caché de npm se guarda en `.cache/npm` dentro del repositorio. `allowScripts` declara los scripts de instalación de las versiones concretas de Prisma, sus motores y esbuild utilizadas por esta base, evitando el aviso de scripts no declarados de npm 11.19.

Antes de reinstalar con `npm ci`, detén los servidores. En Windows, un proceso de Vite que siga abierto puede bloquear su biblioteca nativa y provocar `EPERM`; cierra ese proceso y repite la instalación.

La configuración por defecto permite arrancar sin `.env`. Si necesitas cambiarla:

```powershell
Copy-Item .env.example .env
```

`HOST` y `PORT` configuran Fastify. `BACKEND_URL` es el destino del proxy de Vite y debe coincidir con la dirección del backend. `WEB_ORIGIN` indica el origen del frontend para Socket.IO y las comprobaciones. Reinicia los procesos después de cambiar estas variables. Solo las variables con prefijo `VITE_` se exponen al navegador: nunca pongas secretos en ellas.

## Ejecutar en desarrollo

En una terminal, desde la raíz:

```powershell
npm.cmd run dev:server
```

En una segunda terminal, también desde la raíz:

```powershell
npm.cmd run dev:web
```

- Frontend: <http://localhost:5173>.
- Backend directo: <http://127.0.0.1:3001/api/health>.
- Backend a través del frontend: <http://localhost:5173/api/health>.

Abre el frontend en el navegador: «Servidor» y «Tiempo real» deben mostrar «Conectado». Detén cada proceso con `Ctrl+C` en su terminal.

En esta sesión, `tsx` no pudo consultar los datos del usuario de Windows dentro del sandbox (`uv_os_get_passwd`); el mismo comando arrancó correctamente con permiso para ejecutarse fuera de él. Es una limitación observada del entorno restringido, no requiere cambiar la configuración global de Windows.

El frontend llama a `/api/health` y conecta Socket.IO al mismo origen. Vite reenvía `/api` y `/socket.io` a Fastify. Esto evita añadir una biblioteca CORS HTTP para esta configuración local. Fastify y Socket.IO comparten un único servidor HTTP.

## Comprobar el proyecto

Estos comandos no necesitan una base de datos ni los servidores de desarrollo arrancados:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run prisma:validate
```

- `typecheck`: comprueba TypeScript estricto en todos los paquetes.
- `test`: ejecuta Vitest; comprueba el motor, las salas, el endpoint HTTP y conexiones reales Socket.IO en puertos temporales.
- `build`: compila primero los contratos, después el backend y finalmente el frontend.
- `prisma:validate`: valida la configuración y el esquema vacío; no conecta con PostgreSQL ni aplica migraciones.
- `test:watch`: mantiene Vitest escuchando cambios.

Con **ambos servidores de desarrollo en marcha**, abre una tercera terminal:

```powershell
npm.cmd run smoke
```

Esta comprobación solicita el HTML del frontend, consulta Fastify a través del proxy y comprueba mensajes de ida y vuelta de Socket.IO por polling y WebSocket. No sustituye una revisión visual del navegador.

Para comprobar los archivos compilados después de `build`, usa dos terminales:

```powershell
npm.cmd run start:server
```

```powershell
npm.cmd run preview:web
```

El frontend compilado se sirve en <http://localhost:4173>. Son comandos de vista previa local, no un despliegue de producción.

## Carpetas y archivos principales

```text
apps/
  web/                 React, estilos, Vite y cliente Socket.IO
  server/
    src/               Fastify, configuración, Socket.IO y pruebas
    prisma/            Esquema inicial sin modelos
    prisma.config.ts   Configuración de Prisma para PostgreSQL
packages/
  shared/              Contratos públicos HTTP y Socket.IO
scripts/
  smoke.mjs            Verificación con ambos servicios arrancados
docs/                  Documentación original conservada
```

`App.tsx` usa estado de React para mostrar las conexiones y un efecto para abrirlas y cerrarlas. `app.ts` construye el servidor sin arrancarlo automáticamente, lo que permite probarlo. `index.ts` lo inicia y atiende las señales de cierre. `packages/shared/src/index.ts` define las formas de los mensajes; no contiene reglas ni información privada del juego.

`tsx` es una utilidad de desarrollo para ejecutar y reiniciar el backend TypeScript. Los paquetes `@types/*` proporcionan tipos. No se añaden frameworks, servicios ni infraestructura fuera de la arquitectura aprobada.

## Prisma y PostgreSQL

`schema.prisma` contiene únicamente el proveedor PostgreSQL y la configuración del generador. No incluye entidades de juego ni modelos ficticios para hacer funcionar una prueba.

La URL de ejemplo tiene credenciales ficticias y no se utiliza al arrancar el servidor. No se crea ni se consulta una base de datos. El cliente de Prisma se preparará cuando se apruebe un esquema con modelos; en esta fase no se genera ni se importa desde la aplicación.

No ejecutes migraciones ni sincronizaciones de esquema como parte de estas instrucciones. Antes de conectar PostgreSQL quedan pendientes el modelo definitivo, sus permisos, la configuración local de conexión y el adaptador necesario para Prisma 7.

## Siguiente fase

Revisar las salas y aprobar un alcance concreto antes de continuar. Siguen pendientes liberación de plazas, transferencia del creador, persistencia, varias reglas de rondas, votación, fallecimiento, evaluación y puntuación. La función del agente de IA también necesita aprobación específica.
