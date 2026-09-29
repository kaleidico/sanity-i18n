import { defineConfig } from "tsup";

// Five entry points, one per subpath export. Each builds to ESM plus a .d.ts
// next to it so `@kaleidico/sanity-i18n/sanity`, `/next`, `/next/middleware`,
// `/next/client` and `/engine` resolve without a bundler step in the host. The client entry is
// built on its own so it can carry the "use client" directive.
const shared = {
  format: ["esm"] as const,
  dts: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "es2022" as const,
  outDir: "dist",
  external: ["sanity", "react", "react/jsx-runtime", "next", "next/server", "server-only"],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      "sanity/index": "src/sanity/index.ts",
      "next/index": "src/next/index.ts",
      "next/middleware/index": "src/next/middleware/index.ts",
      "engine/index": "src/engine/index.ts",
    },
    // Cleaning is done by the build script, not here: the two builds run at
    // the same time and a clean in one would wipe the other's output.
    clean: false,
  },
  {
    ...shared,
    entry: { "next/client/index": "src/next/client/index.tsx" },
    clean: false,
    // The treeshake pass (rollup) drops module directives, so it is off here
    // and esbuild keeps the file's own "use client".
    treeshake: false,
  },
]);
