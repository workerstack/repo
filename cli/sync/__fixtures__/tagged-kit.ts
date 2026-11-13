// A tagged three-package workspace, written to a temp dir: its `@tagged/*` imports resolve nowhere tsc looks.
import { put, tempDir } from "./temp-dirs.ts";

/** Usage's tag map under `@tagged/*`: the app may import ui and lib, ui only lib, lib nothing else. */
export const TAGGED_BOUNDARIES = {
  allow: { app: ["ui", "lib"], lib: [], ui: ["lib"] },
  tags: { "@tagged/lib": "lib", "@tagged/ui": "ui", "@tagged/web": "app" },
};

/** Each package's dir name, the packages its manifest declares, and its one source file. */
const PACKAGES: Record<string, { declares: string[]; source: string }> = {
  lib: {
    declares: ["@tagged/ui"],
    source: 'import type { Ui } from "@tagged/ui";\n\nexport const lib = "lib";\nexport type Lib = Ui;\n',
  },
  ui: {
    declares: ["@tagged/lib"],
    source: 'import { lib } from "@tagged/lib";\n\nexport const ui = `${lib}-ui`;\nexport type Ui = typeof ui;\n',
  },
  web: {
    declares: ["@tagged/lib", "@tagged/ui"],
    source: 'import { lib } from "@tagged/lib";\nimport { ui } from "@tagged/ui";\n\nexport const web = [lib, ui];\n',
  },
};

/** The manifest of the package in `packages/<dir>`, declaring what it imports. */
function manifestOf(dir: string, declares: readonly string[]): string {
  const dependencies = Object.fromEntries(declares.map((name) => [name, "workspace:*"]));
  return `${JSON.stringify({ dependencies, name: `@tagged/${dir}`, type: "module" }, null, 2)}\n`;
}

/**
 * A temp root (removed after the test, under `useTempDirs`) whose standards config sets `boundaries` as
 * `lint.boundaries`, over `packages/{web,ui,lib}`; lib's one import, of ui, is the one its tag may not make.
 */
export function taggedTree(boundaries: unknown = TAGGED_BOUNDARIES): string {
  const root = tempDir("workerstack-tagged-");
  const manifest = { name: "@tagged/root", private: true, type: "module", workspaces: ["packages/*"] };
  put(root, "package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const config = { lint: { boundaries }, packs: ["standards"] };
  put(root, "repo.config.ts", `export default ${JSON.stringify(config, null, 2)};\n`);
  for (const [dir, { declares, source }] of Object.entries(PACKAGES)) {
    put(root, `packages/${dir}/package.json`, manifestOf(dir, declares));
    put(root, `packages/${dir}/src/${dir}.ts`, source);
  }
  return root;
}
