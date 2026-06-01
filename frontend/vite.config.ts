import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split marked into its own chunk — it's ~50KB and only used on
          // the dynamics page and article modal, not on login or empty chat.
          marked: ["marked"],
        },
      },
    },
  },
});
