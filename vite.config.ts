import { defineConfig } from "vite";

// File saves must not touch a running page. Refresh the browser to pick them up.
export default defineConfig({
  server: {
    port: 5200,
    hmr: false,
    watch: null,
  },
});
