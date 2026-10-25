import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { readSurvivorConfig } from './rooms/survivor-gemini.js';

export function readServerConfig() {
  // src/ y dist/ tienen la misma profundidad respecto a la raiz del monorepo.
  const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(envPath)) loadEnvFile(envPath);
  const port = Number(process.env["PORT"] ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT debe ser un entero entre 1 y 65535.");
  }
  return {
    host: process.env["HOST"] ?? "127.0.0.1",
    port,
    webOrigin: process.env["WEB_ORIGIN"] ?? "http://localhost:5173",
    survivor: readSurvivorConfig(process.env),
  };
}
