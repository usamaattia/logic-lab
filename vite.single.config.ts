import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML file: opens from a USB stick or an LMS upload, no server needed.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: { outDir: "dist-single" },
});
