import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base "./" so the built site works under any path (e.g. a GitHub Pages project site)
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { include: ["tests/**/*.test.ts"] },
});
