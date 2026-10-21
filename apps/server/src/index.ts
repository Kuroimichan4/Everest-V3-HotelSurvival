import { buildApp } from "./app.js";
import { readServerConfig } from "./config.js";

const config = readServerConfig();
const app = buildApp({ logger: true, webOrigin: config.webOrigin });
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await stop();
}
