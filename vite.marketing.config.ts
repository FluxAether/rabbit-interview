import { defineConfig } from "vite";

export default defineConfig({
  root: "marketing",
  base: "/rabbit-interview-downloads/",
  publicDir: "public",
  build: {
    outDir: "../dist-marketing",
    emptyOutDir: true,
  },
});
