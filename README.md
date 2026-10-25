# Everest-V3-HotelSurvival

Simulación web multijugador de supervivencia en un hotel parcialmente derrumbado tras un terremoto. Cuatro participantes humanos recorren seis rondas, debaten y votan cómo continuar, gestionan recursos y utilizan capacidades de roles asimétricos: Mantenimiento, Médico, Arquitecto/Ingeniero y Botones.

Incluye fichas privadas, chat en tiempo real, encuentros con supervivientes NPC que piden ayuda, resultados colectivos e individuales con narrativa dramática y una opción de nueva partida. Los NPC funcionan sin conexión en modo de demostración o, opcionalmente, generan argumentos mediante Gemini API. Sus mensajes no votan ni ejecutan acciones del juego.

## Tecnologías y estructura

- React 19, TypeScript estricto y Vite para la interfaz.
- Node.js, Fastify y Socket.IO para un único servidor autoritativo y comunicación en tiempo real.
- Contratos compartidos en `packages/shared`; npm workspaces y `package-lock.json`.
- Vitest y clientes Socket.IO reales para las pruebas; `tsx` para desarrollo del servidor.
- Gemini API opcional mediante `fetch` nativo de Node, sin SDK externo.

```text
apps/web/              Interfaz React y Vite
apps/server/src/       Servidor, salas, simulación y agente NPC
packages/shared/       Contratos públicos
scripts/               Comprobaciones locales
apps/server/prisma/    Preparación inicial, sin base de datos operativa
docs/                  Documentos originales conservados
```

Las partidas, credenciales de sala e historiales se conservan **en memoria**: F5 recupera la sesión mientras viva el servidor, pero reiniciar Node pierde las salas. No hay persistencia en PostgreSQL ni puntuaciones numéricas.

## Requisitos

- Node.js **24.11.0 o posterior dentro de la rama 24** (`>=24.11.0 <25`).
- npm **11**; el repositorio declara npm 11.19.1.
- Un navegador moderno. Para cuatro participantes locales, usar navegadores o perfiles independientes.
- No se necesita clave API, base de datos, migraciones ni herramientas globales para jugar en demo.

Abrir una terminal **en la raíz del repositorio**. Con una instalación convencional compatible de Node.js:

```powershell
node --version
npm.cmd --version
```

En Windows se usa `npm.cmd` para evitar depender de la política de scripts de PowerShell. En macOS/Linux utilizar `npm` en lugar de `npm.cmd` y omitir las instrucciones de PATH específicas de Windows.

### Node portátil en Windows

Si se utiliza la distribución local existente, ejecutar **en cada terminal nueva**:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;$env:Path"
node --version
npm.cmd --version
```

`.tools/` no se versiona ni se necesita con una instalación convencional de Node. Quien clone el proyecto debe instalar Node compatible o aportar su propia distribución portátil.

## Instalación y configuración

Instalar una vez desde la raíz; npm enlaza los tres workspaces:

```powershell
npm.cmd ci
```

El lockfile fija las dependencias. `.npmrc` exige versiones compatibles y guarda la caché en `.cache/npm`. Detener los procesos de desarrollo antes de reinstalar: Windows puede bloquear bibliotecas nativas abiertas.

La aplicación puede arrancar en demo sin archivo `.env`. Para preparar una configuración local, copiar la plantilla **solo si no existe ya**:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

No sobrescribir un `.env` que ya contenga configuración privada. La plantilla `.env.example` contiene una clave vacía y `SURVIVOR_AI_MODE=demo`.

| Variable | Uso / valor inicial |
|---|---|
| `HOST` | Servidor local: `127.0.0.1` |
| `PORT` | Fastify: `3001` |
| `WEB_ORIGIN` | Frontend de desarrollo: `http://localhost:5173` |
| `BACKEND_URL` | Destino del proxy Vite: `http://127.0.0.1:3001` |
| `SURVIVOR_AI_MODE` | `demo` por defecto; opcionalmente `gemini` |
| `GEMINI_API_KEY` | Secreto del servidor, vacío en la plantilla |
| `GEMINI_MODEL` | Modelo configurable: `gemini-3.5-flash-lite` |
| `SURVIVOR_AI_TIMEOUT_MS` | `2500`; admite 100–4000 ms |
| `SURVIVOR_AI_MAX_CALLS` | `15` por partida; admite 0–15 |

El servidor carga `.env` de la raíz; las variables ya definidas en el entorno tienen prioridad. Vite usa `BACKEND_URL` para su proxy y solo expone al cliente variables con prefijo `VITE_`. **Nunca poner claves en variables `VITE_*`.** Reiniciar los procesos después de cambiar configuración.

## Arranque en desarrollo

Mantener abiertas dos terminales, ambas en la raíz. Si se usa Node portátil, incluir la línea de PATH en **las dos**, no solo en la del servidor.

Terminal del servidor:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;$env:Path" # Omitir con Node instalado
npm.cmd run dev:server
```

Terminal del frontend:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;$env:Path" # Omitir con Node instalado
npm.cmd run dev:web
```

Estos scripts compilan los contratos compartidos; el servidor se ejecuta con `tsx watch` y el frontend con Vite.

- Juego: **http://localhost:5173**.
- Salud del servidor: http://127.0.0.1:3001/api/health.
- Salud a través del proxy: http://localhost:5173/api/health.

Abrir el juego, no el puerto del backend. Socket.IO y `/api` pasan por el mismo proxy de Vite. Detener con `Ctrl+C`. Los puertos del frontend son estrictos: si están ocupados, detener la instancia anterior o revisar el proceso que los utiliza.

### Jugar sin Gemini

Conservar `SURVIVOR_AI_MODE=demo` en `.env`. No requiere clave ni realiza llamadas al proveedor. Para forzar demo en la terminal del servidor aunque el archivo local tenga otro modo:

```powershell
$env:SURVIVOR_AI_MODE = 'demo'
npm.cmd run dev:server
```

El modo demo usa mensajes deterministas, no un modelo generativo real.

### Activar Gemini opcionalmente

1. Crear una clave en [Google AI Studio](https://aistudio.google.com/api-keys) y comprobar disponibilidad, nivel de facturación y cuotas del proyecto.
2. Guardarla únicamente en el `.env` privado y establecer `SURVIVOR_AI_MODE=gemini`. Conservar o ajustar `GEMINI_MODEL`, timeout y presupuesto. No escribir la clave en `.env.example`, el código, el chat o capturas públicas.
3. Si se forzó demo en PowerShell, establecer `$env:SURVIVOR_AI_MODE = 'gemini'` en esa terminal o retirar esa variable de proceso para volver a utilizar el archivo.
4. Reiniciar el servidor y comenzar una nueva partida.

Gemini genera argumentos durante las votaciones de rescate, sujeto a disponibilidad y condiciones de Google. Si falla, se agota la cuota o tarda demasiado, se utiliza el respaldo determinista. El límite local de llamadas no sustituye las cuotas y condiciones del proveedor. El modelo no recibe conversación humana ni información privada de los jugadores.

## Cómo jugar con cuatro personas

1. Abrir http://localhost:5173 en cuatro navegadores o perfiles independientes. También pueden utilizarse ventanas privadas que mantengan almacenamientos separados; varias pestañas del mismo perfil pueden reutilizar la misma credencial.
2. Una persona crea una sala y comparte su código; las otras tres se unen con sus nombres.
3. El anfitrión inicia cuando los cuatro están conectados. Cada participante consulta su ficha privada y los controles autorizados para su rol.
4. Debatir mediante el chat, compartir voluntariamente información y votar antes de que termine el plazo. Escribir en el chat no revela rutas oficialmente ni ejecuta capacidades.
5. Utilizar las capacidades disponibles y gestionar recursos mientras se avanza por las seis rondas. Los encuentros NPC y las decisiones de transporte se resuelven con sus propios controles.
6. Consultar el desenlace colectivo y el objetivo privado propio. No todos los personajes tienen los mismos permisos ni información.
7. Tras revisar los resultados, el anfitrión puede pulsar **Nueva partida** si están los cuatro conectados. Todos vuelven al lobby, se borra el chat anterior y el inicio existente crea una partida nueva con recursos reiniciados y otro sorteo de roles.

F5 recupera la sesión mientras la sala exista en el proceso del servidor. Los personajes eliminados mantienen sus restricciones. No se incluyen aquí los objetivos secretos de los roles.

### Cuatro dispositivos en una red local

La configuración entregada escucha en **loopback**: Vite usa `localhost` y Fastify `127.0.0.1`. No basta con abrir la IP del ordenador desde otro dispositivo. El acceso LAN requiere revisar interfaces de escucha, origen, proxy y firewall; queda pendiente de una configuración y autorización específicas. No se habilita exposición pública ni se relajan controles en esta entrega.

## Comprobaciones y compilación

Desde la raíz, con Node disponible:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
```

- `typecheck`: compila los contratos y comprueba TypeScript estricto.
- `test`: ejecuta Vitest, incluido motor, permisos, salas, reinicio y conexiones Socket.IO reales. Las pruebas del proveedor usan respuestas simuladas; no llaman a Gemini.
- `build`: compila contratos, servidor e interfaz. Genera `dist/` en los workspaces.

Con ambos servicios de desarrollo encendidos se puede ejecutar `npm.cmd run smoke` en otra terminal para verificar HTTP, proxy y Socket.IO. Si se pretende una comprobación sin proveedor, arrancar primero el servidor en demo.

Para comprobar los compilados localmente después de `build`, en dos terminales:

```powershell
npm.cmd run start:server
```

```powershell
npm.cmd run preview:web
```

La vista previa está en http://localhost:4173. Ajustar `WEB_ORIGIN=http://localhost:4173` para esa sesión del servidor y del comando smoke si se utiliza. Es una vista previa local; no constituye una configuración de despliegue público.

## Base de datos y archivos generados

Prisma y `@prisma/client` están declarados por la preparación inicial, pero el juego actual no utiliza una base de datos. No se necesita generar un cliente, crear PostgreSQL ni ejecutar migraciones para instalar, compilar o jugar. `DATABASE_URL` de la plantilla es ficticia y no activa persistencia. `npm.cmd run prisma:validate` es una comprobación opcional del esquema inicial.

Para entregar o clonar se necesitan el código fuente, manifiestos de los workspaces, `package-lock.json`, `.npmrc`, configuración TypeScript/Vite/Vitest, `.env.example` y este README. No incluir `node_modules/`, `dist/`, `.cache/`, `.tools/`, logs, `.env` ni copias de credenciales. Se regeneran dependencias y compilados con los pasos anteriores. Los documentos originales de `docs/` se conservan íntegros.

## Seguridad de credenciales

`.gitignore` excluye `.env` y sus copias; únicamente `.env.example` se permite como plantilla versionada y debe conservar las claves vacías. Ignorar un archivo no elimina una clave de commits anteriores. Si una clave llegó a versionarse, revocarla en Google AI Studio y reemplazarla en el entorno privado; no basta con borrar su línea de la versión actual. No publicar configuraciones completas en logs o mensajes de error.

La plantilla mantiene la clave vacía; la aplicación no activa Gemini automáticamente ni configura acceso público o persistencia. Una distribución portátil de Node, los servicios externos y sus cuotas no forman parte del repositorio.