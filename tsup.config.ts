import { defineConfig } from "tsup";

// Three entry points, one per subpath export. Each builds to ESM plus a
// .d.ts next to it so `@kaleidico/sanity-i18n/sanity`, `/next` and `/engine`
// resolve without a bundler step in the host.
export default defineConfig({
  entry: {
    "sanity/index": "src/sanity/index.ts",
    "next/index": "src/next/index.ts",
    "engine/index": "src/engine/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  outDir: "dist",
  external: ["sanity", "react", "next", "server-only"],
});
