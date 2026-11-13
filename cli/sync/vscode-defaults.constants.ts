export const EXTENSIONS_PATH = ".vscode/extensions.json";

/** The first TypeScript major with a native server: it has no `tsserver.js`, so `typescript.tsdk` cannot pick it. */
export const NATIVE_TYPESCRIPT_MAJOR = 7;

export const TYPESCRIPT_PACKAGE = "node_modules/typescript/package.json";
export const VITEST_PACKAGE = "node_modules/vitest/package.json";

export const OXC_EXTENSION = "oxc.oxc-vscode";
export const BUN_FORMATTER_EXTENSION = "wdomitrz.simple-lsp-client";
export const NATIVE_TYPESCRIPT_EXTENSION = "TypeScriptTeam.native-preview";
export const TAILWIND_EXTENSION = "bradlc.vscode-tailwindcss";
export const VITEST_EXTENSION = "vitest.explorer";

/** The language ids `bun fmt` formats that an editor opens; a `.css` file is `tailwindcss` in Tailwind mode. */
export const BUN_FORMAT_LANGUAGES: readonly string[] = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "json",
  "jsonc",
  "css",
  "tailwindcss",
  "scss",
];

/** Bun's formatter on stdin; `--no-script` so a package.json `fmt` script never runs in its place. */
export const BUN_FORMAT_COMMAND: readonly string[] = ["bun", "fmt", "--no-script", "--stdin-filepath", "${file}"];
