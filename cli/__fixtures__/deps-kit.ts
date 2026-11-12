/** A temp package for the type-surface scan: its manifest, its tsconfig, its files and fake installed typed packages. */

/** A fake installed package: the text of its `index.d.ts` and the `dependencies` its own manifest lists. */
export type Installed = { types: string; dependencies?: Record<string, string> };

/** What a kit holds: the package's manifest, extra compiler options, files by path, and installed packages by name. */
export type Kit = {
  manifest: Record<string, unknown>;
  options?: Record<string, unknown>;
  files?: Record<string, string>;
  installed?: Record<string, Installed>;
};

const OPTIONS = {
  allowImportingTsExtensions: true,
  lib: ["ES2022"],
  module: "Preserve",
  moduleResolution: "bundler",
  skipLibCheck: true,
  strict: true,
  target: "ES2022",
  types: [],
};

/** The kit's files by package-relative path, ready for a temp tree. */
export function kitFiles({ manifest, options = {}, files = {}, installed = {} }: Kit): Record<string, string> {
  const tree: Record<string, string> = {
    "package.json": JSON.stringify({ name: "pkg", private: false, ...manifest }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...OPTIONS, ...options } }),
    ...files,
  };

  for (const [name, { types, dependencies }] of Object.entries(installed)) {
    tree[`node_modules/${name}/package.json`] = JSON.stringify({ dependencies, name, types: "index.d.ts" });
    tree[`node_modules/${name}/index.d.ts`] = types;
  }

  return tree;
}

/** An installed package `kit` with one exported type, `Kit`. */
export const KIT: Record<string, Installed> = { kit: { types: "export type Kit = { name: string };\n" } };
