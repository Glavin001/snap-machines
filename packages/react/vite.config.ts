import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    dts({ tsconfigPath: "./tsconfig.json" }),
  ],
  resolve: {
    alias: {
      "@snap-machines/core": path.resolve(__dirname, "../snap-machines/src"),
    },
  },
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        "react",
        "react/jsx-runtime",
        "react-dom",
        "three",
        "@react-three/fiber",
        "@dimforge/rapier3d-compat",
        "@snap-machines/core",
      ],
    },
  },
});
