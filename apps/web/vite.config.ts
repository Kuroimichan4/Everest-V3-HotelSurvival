import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readNetworkConfig } from '../../config/network.mjs';

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const network = readNetworkConfig(env);
  const target = network.backendUrl;
  const proxy = { "/api": { target }, "/socket.io": { target, ws: true } };
  const lanFiles = network.mode === 'lan' ? { fs: { strict: true,
    allow: [fileURLToPath(new URL('./', import.meta.url)), fileURLToPath(new URL('../../packages/shared/', import.meta.url)), fileURLToPath(new URL('../../node_modules/', import.meta.url))],
    deny: ['**/.env*', '**/*.{crt,pem}', '**/.git/**'],
  } } : {};
  return {
    plugins: [react()],
    envDir: workspaceRoot,
    server: { host: network.frontendHost, port: network.frontendPort, strictPort: true, proxy,
      allowedHosts: ['localhost', network.frontendHost], cors: { origin: network.webOrigins }, ...lanFiles },
    preview: { host: "localhost", port: 4173, strictPort: true, proxy },
  };
});
