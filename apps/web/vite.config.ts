import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the browser talks to /api on the same origin and Vite
    // forwards it to the API, so no CORS setup is needed.
    proxy: {
      "/api": { target: "http://localhost:3333", rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
});
