import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("No se encuentra el contenedor de React.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
