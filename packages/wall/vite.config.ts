import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: { port: 5173, host: "0.0.0.0" },
  build: { target: "es2022", cssCodeSplit: false },
});
