import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "127.0.0.1", port: 3100 },
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart({ srcDirectory: "admin/app" }), viteReact(), tailwindcss()],
});
