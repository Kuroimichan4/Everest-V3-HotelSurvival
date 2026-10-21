import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const target = env["BACKEND_URL"] ?? "http://127.0.0.1:3001";
  const proxy = { "/api": { target }, "/socket.io": { target, ws: true } };
  return {
    plugins: [react()],
    envDir: workspaceRoot,
    server: { host: "localhost", port: 5173, strictPort: true, proxy },
    preview: { host: "localhost", port: 4173, strictPort: true, proxy },
  };
});
