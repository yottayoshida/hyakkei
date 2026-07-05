import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Editor build config (ARCHITECTURE §5, ADR-0004). Real editor UI lands in M2 (#11-#16).
export default defineConfig({
  plugins: [react()],
});
