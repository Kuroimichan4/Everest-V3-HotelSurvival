# Fase 10M.2 — Multijugador LAN opcional

## Implementación

El modo predeterminado sigue siendo `local`. Con `EVEREST_NETWORK_MODE=lan`, ambos procesos utilizan `EVEREST_LAN_HOST`, la IPv4 privada elegida por el anfitrión. Vite escucha exclusivamente en esa interfaz; no se utiliza una dirección comodín. Las IP públicas y direcciones no privadas se rechazan.

Fastify sigue en loopback. Su proxy solo admite un destino HTTP de loopback sin credenciales ni rutas adicionales. Se autorizan únicamente los orígenes concretos de localhost y de la IP/puerto LAN. Socket.IO aplica la misma lista al handshake de polling y WebSocket. Los clientes nativos sin cabecera Origin conservan el protocolo autenticado de sala existente; la comprobación de origen no sustituye las credenciales.

En LAN, Vite limita el acceso a archivos a la interfaz, contratos compartidos y dependencias. No permite acceder a `.env`, claves, Git ni al código del servidor mediante `/@fs/`. No se exporta configuración privada a React. No cambian mecánicas, permisos de rol, IA, chat, votaciones o temporizadores.

## Archivos

- Nuevos `config/network.mjs` y `config/network.d.mts`: validación y política compartida, sin datos de Gemini.
- `apps/web/vite.config.ts`: escucha, proxy, CORS explícito y restricciones de archivos.
- `apps/server/src/config.ts`, `index.ts` y `app.ts`: backend loopback y lista de orígenes, incluido handshake WebSocket.
- `.env.example`: modo local, dirección LAN vacía y puerto del frontend.
- `README.md`: arranque Windows, firewall manual, vuelta a localhost y límites de acceso.
- Nuevo `apps/server/src/network.test.ts` y `scripts/smoke-lan.mjs`: comprobaciones específicas y prueba de red real desde el anfitrión.
- Este informe. El `.env` privado no se modifica.

## Arranque Windows

En el anfitrión ejecutar `ipconfig` y localizar la Dirección IPv4 del adaptador Wi-Fi/Ethernet de la red compartida. En dos terminales de la raíz:

```powershell
# Repetir en ambas terminales si se utiliza Node portátil.
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;$env:Path"
$env:EVEREST_NETWORK_MODE = 'lan'
$env:EVEREST_LAN_HOST = Read-Host 'IPv4 LAN del anfitrión obtenida con ipconfig'
```

En la primera ejecutar `npm.cmd run dev:server` y en la segunda `npm.cmd run dev:web`. Introducir la misma IPv4 en ambas. Los jugadores abren **`http://<IPv4-LAN-del-anfitrión>:5173`**, incluido quien ejecuta el juego. No hay una IP LAN fija en los archivos del proyecto.

Para probar sin proveedor, establecer `$env:SURVIVOR_AI_MODE='demo'` en la terminal del servidor. LAN no modifica la elección demo/Gemini.

Si Windows solicita permiso, autorizar Node/Vite solo en una red privada de confianza. No desactivar el firewall ni autorizar redes públicas. Si hace falta una regla específica, configurarla manualmente para el puerto TCP del frontend, perfil privado y subred local. El puerto del backend no necesita entrada de red.

Para volver: detener ambos procesos, establecer `$env:EVEREST_NETWORK_MODE='local'` en las dos terminales, retirar `EVEREST_LAN_HOST` de su entorno y arrancar de nuevo. En modo local vuelve a utilizarse `http://localhost:5173`. La vista previa compilada permanece local.

Esto no configura un despliegue por Internet: no se abren puertos del router, no se crean túneles y no se cambian reglas del sistema operativo. No se debe publicar el servidor Vite mediante redirecciones externas.

## Comprobaciones

- **38 pruebas relevantes aprobadas** en seis archivos: configuración, Fastify, Socket.IO, salas, NPC demo/Gemini simulado, seis rondas y reinicio. No se ejecuta de nuevo toda la suite del motor.
- TypeScript, compilación de producción y `git diff --check`: correctos.
- `node scripts/smoke-lan.mjs`: modos local y LAN sobre la interfaz privada real del equipo, con servicios aislados en puertos temporales y cuatro clientes.
- Pasa HTML, módulo frontend, proxy HTTP, polling y WebSocket con Origin autorizado; roles privados, chat sincronizado, mensaje NPC demo, voto y reconexión.
- Orígenes ajenos rechazados en ambos transportes. CORS sin comodines. Fastify no responde por la IP LAN. Lectura HTTP de `.env` y fuente del backend rechazada.
- Sin llamadas reales a Gemini, dependencias nuevas, cambios en `docs/`, firewall o router. Sin commit ni push.

## Pendiente manual desde otro ordenador

La prueba LAN se realizó desde el anfitrión hacia su interfaz privada, no desde un segundo equipo físico. Falta comprobar el firewall y la comunicación entre dispositivos: conectar dos equipos a la misma red, abrir la URL LAN, crear/unirse a la misma sala, verificar rol propio, chat, voto y F5. Después repetir con cuatro personas y completar una partida. Si no conecta, revisar IP/puerto, red privada y posible aislamiento de clientes de una Wi-Fi de invitados; no abrir el router como solución.

Referencias concretas consultadas: [Vite: host y CORS](https://vite.dev/config/server-options) y [Socket.IO: CORS y allowRequest](https://socket.io/docs/v4/handling-cors).
