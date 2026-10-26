import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { readSurvivorConfig } from './rooms/survivor-gemini.js';
import { readNetworkConfig } from '../../../config/network.mjs';

export function readServerConfig() {
  // src/ y dist/ tienen la misma profundidad respecto a la raiz del monorepo.
  const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(envPath)) loadEnvFile(envPath);
  const network = readNetworkConfig(process.env);
  return {
    host: network.backendHost,
    port: network.backendPort,
    webOrigin: network.webOrigin,
    webOrigins: network.webOrigins,
    survivor: readSurvivorConfig(process.env),
  };
}
