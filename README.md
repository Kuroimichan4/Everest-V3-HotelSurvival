# Hotel Survival — Everest V3

**Un juego cooperativo de supervivencia para cuatro personas.**

Un terremoto ha dejado un hotel parcialmente derrumbado. Cuatro supervivientes tienen que colaborar para salir con vida. Cada uno conoce información diferente y tiene sus propios objetivos, así que no siempre será fácil ponerse de acuerdo.

La partida tiene **seis rondas**. Los jugadores pueden hablar por un chat, votar qué hacer, utilizar habilidades especiales y decidir si ayudan a otros supervivientes. Sus decisiones afectan a la salud, la energía, los recursos y al resultado final.

## 1. ¿Cómo se juega?

1. Una persona crea una sala y comparte el código con los demás.
2. Los otros tres jugadores entran en la sala desde sus navegadores.
3. Cuando están los cuatro, el anfitrión inicia la partida.
4. Cada jugador recibe un rol y una ficha con información privada: **Mantenimiento, Médico, Arquitecto/Ingeniero o Botones**.
5. En cada ronda, el equipo debate, utiliza sus habilidades y vota cómo actuar antes de que acabe el tiempo.
6. Al finalizar, el juego muestra qué ha ocurrido con el equipo y el resultado individual de cada participante.
7. Si los cuatro siguen conectados, el anfitrión puede elegir **Nueva partida**.

**Importante:** cada jugador debe utilizar un navegador o perfil independiente para no compartir la misma sesión.

## 2. ¿Qué necesito para ejecutarlo?

En el ordenador que hará de **anfitrión** (el que ejecutará el juego):

- **Node.js 24**, versión 24.11 o posterior dentro de la versión 24.
- **npm 11** (gestor de paquetes que se instala con Node.js).
- Una terminal, por ejemplo PowerShell, y un navegador actualizado.
- El proyecto descargado desde GitHub.

Los demás jugadores **solo necesitan un navegador** si se conectan desde la misma red local.

El servidor lleva el control de la partida: guarda los votos, aplica las reglas y comunica los resultados a todos. Así, cada jugador ve la misma situación. En este proyecto, el servidor se ejecuta en el ordenador anfitrión.

## 3. Instalar el proyecto (solo la primera vez)

1. Descarga el repositorio de GitHub y descomprímelo, o clónalo con GitHub Desktop.
2. Abre una terminal **dentro de la carpeta principal** `Everest-V3-HotelSurvival`.
3. Comprueba que Node y npm están disponibles:

   ```powershell
   node --version
   npm.cmd --version
   ```

4. Instala lo necesario para ejecutar el juego:

   ```powershell
   npm.cmd ci
   ```

**Si utilizas Windows con la copia portátil de Node del proyecto**, antes de los comandos anteriores ejecuta esta línea en **cada terminal nueva**:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;$env:Path"
```

La carpeta `.tools` es una instalación local opcional y **no se descarga desde GitHub**. Si ya tienes Node instalado, no necesitas ese comando.

## 4. Jugar en un solo ordenador

Abre **dos terminales** en la carpeta principal del proyecto y mantenlas abiertas.

**Terminal 1: iniciar el servidor**

```powershell
npm.cmd run dev:server
```

**Terminal 2: iniciar la página del juego**

```powershell
npm.cmd run dev:web
```

Abre esta dirección en el navegador:

**http://localhost:5173**

Puedes simular cuatro participantes usando cuatro navegadores o perfiles diferentes del mismo ordenador.

Para detener los programas, pulsa **Ctrl + C** en cada terminal.

## 5. Jugar desde varios ordenadores o móviles (misma Wi-Fi o red local)

Este modo permite que los cuatro jugadores usen dispositivos diferentes **conectados a la misma red**. Ya se ha comprobado el acceso desde un PC y un móvil.

**En el ordenador anfitrión:**

1. Abre PowerShell y escribe `ipconfig`.
2. Busca la **Dirección IPv4** de la conexión de red que estás usando. No la confundas con la *Puerta de enlace*, que suele ser la dirección del router.
3. Abre dos terminales en la carpeta del proyecto. Si utilizas Node portátil, ejecuta primero el comando de `.tools` del apartado 3 en ambas.
4. Ejecuta los siguientes comandos **uno por uno**. Sustituye `192.168.1.50` por la IPv4 real del anfitrión.

**Terminal 1 — servidor:**

```powershell
$env:EVEREST_NETWORK_MODE = 'lan'
$env:EVEREST_LAN_HOST = '192.168.1.xx'
npm.cmd run dev:server
```

**Terminal 2 — página web:**

```powershell
$env:EVEREST_NETWORK_MODE = 'lan'
$env:EVEREST_LAN_HOST = '192.168.1.xx'
npm.cmd run dev:web
```

**En todos los dispositivos:** abre la misma dirección en la **barra de direcciones** del navegador, cambiando el ejemplo por la IPv4 real:

**http://192.168.1.xx:5173**

Después, un jugador crea una sala y los demás se unen con el código.

Si Windows muestra un aviso de acceso a la red, autorízalo **solo en redes privadas de confianza**. No es necesario abrir puertos del router ni desactivar el firewall. Algunas redes de invitados impiden que los dispositivos se comuniquen entre sí.

**Este modo es para una red local, no para jugar desde casas distintas a través de Internet.** Para volver al modo normal, detén ambos procesos y ábrelos en dos terminales nuevas sin configurar `EVEREST_NETWORK_MODE`.

## 6. Supervivientes con inteligencia artificial (Gemini)

Los supervivientes atrapados que aparecen durante algunas votaciones pueden escribir mensajes pidiendo ayuda. Hay dos modos:

- **Demo:** utiliza mensajes ya preparados. No necesita Internet para consultar a Gemini ni una clave API. Es el modo predeterminado y el recomendado para comprobar que todo funciona.
- **Gemini:** utiliza inteligencia artificial para generar mensajes diferentes según el momento de la votación. Necesita conexión y una clave API de Google.

**Cómo activar Gemini (opcional):**

1. Crea una clave en [Google AI Studio](https://aistudio.google.com/api-keys).
2. En la carpeta principal del proyecto, crea un archivo llamado `.env` a partir de `.env.example` **solo si no tienes ya uno**.
3. En `.env`, configura estas líneas con tu propia clave:

   ```env
   SURVIVOR_AI_MODE=gemini
   GEMINI_API_KEY= Clave privada de Gemini
   ```

4. Guarda el archivo y reinicia el servidor. Si antes habías forzado el modo demo desde PowerShell, inicia una terminal nueva para evitar que esa configuración tenga prioridad.

## 7. Información útil y límites actuales

- Las partidas se guardan **temporalmente en el servidor**. Si actualizas la página puedes recuperar tu sesión mientras el servidor siga funcionando, pero **al reiniciar el servidor se pierden las salas activas**.
- No hace falta instalar una base de datos.
- Para jugar desde equipos distintos debe mantenerse encendido el ordenador anfitrión con las dos terminales abiertas.
- La pantalla del móvil permite acceder al juego, aunque la comodidad de uso puede depender del tamaño de pantalla.
- El repositorio puede ser **privado**: si aparece un error 404 al abrir su enlace, puede ser necesario iniciar sesión en GitHub con una cuenta invitada.

## 8. Para quienes quieran revisar el código

El proyecto utiliza **React y Vite** para mostrar el juego; **Node.js y Fastify** para gestionar la partida; **Socket.IO** para que los jugadores reciban los cambios al instante; y **Gemini** para generar algunos mensajes de los supervivientes.

| Carpeta | Contenido |
|---|---|
| `apps/web/` | Pantallas y botones que ven los jugadores. |
| `apps/server/src/` | Reglas, salas, votaciones y NPC. |
| `packages/shared/` | Datos que comparten la web y el servidor. |
| `scripts/` | Herramientas para comprobar que funciona. |
| `docs/` | Documentos de diseño del proyecto. |

Si quieres ejecutar las comprobaciones técnicas desde la carpeta principal:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Estas órdenes revisan el código, ejecutan pruebas y generan una versión compilada. No necesitan una clave de Gemini. El juego se puede instalar y jugar sin configurar Prisma ni PostgreSQL.

---

**Resumen:** instala Node y las dependencias, abre dos terminales, inicia el servidor y la web, y entra en la dirección del juego. Para jugar con otros dispositivos, activa el modo LAN y utiliza la IPv4 del anfitrión.
