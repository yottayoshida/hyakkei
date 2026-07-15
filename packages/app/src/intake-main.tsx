import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntakeApp } from "./intake/IntakeApp.js";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    <IntakeApp />
  </StrictMode>,
);
