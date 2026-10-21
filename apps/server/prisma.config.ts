import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // URL ficticia para validar sin necesitar una base de datos.
    url: process.env["DATABASE_URL"] ??
      "postgresql://placeholder:placeholder@127.0.0.1:5432/everest_placeholder",
  },
});
