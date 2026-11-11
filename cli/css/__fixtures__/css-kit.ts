/** Temp CSS consumers for the Stylelint tests: a synced, committed standards checkout with planted sheets. */
import fs from "node:fs";
import path from "node:path";

import { consumer, tempDir } from "../../scripts/__fixtures__/turn-repo.ts";

/** A Tailwind v4 sheet with each v4 at-rule, `@config`, `@plugin`, `--alpha()` and `--spacing()`: every rule passes. */
export const APP_CSS = `@import "tailwindcss";

@config "../tailwind.config.js";

@plugin "@tailwindcss/typography";

@source "../components";

@reference "./theme.css";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-brand: oklch(62% 0.2 250deg);
  --spacing-gutter: 1.5rem;
}

@utility content-auto {
  content-visibility: auto;
}

@layer components {
  .button {
    @apply rounded px-4;

    padding: --spacing(2);
    color: --alpha(var(--color-brand) / 50%);
  }
}

.link {
  @variant hover {
    color: var(--color-brand);
  }
}
`;

/** A long hex at 4:10 and `display` after `color` at 9:3: both fixable. */
export const BAD_CSS = `.card {
  display: block;
  margin: 0;
  color: #ffffff;
}

.badge {
  color: red;
  display: flex;
}
`;

/** `BAD_CSS` as Stylelint's fix leaves it. */
export const FIXED_CSS = `.card {
  display: block;
  margin: 0;
  color: #fff;
}

.badge {
  display: flex;
  color: red;
}
`;

/** An unknown property at 2:3, which no fix can rewrite. */
export const UNKNOWN_CSS = ".x {\n  colr: red;\n}\n";

/** The sheets of a full kit: a bad one under a `__fixtures__` dir too, which is never linted. */
export const SHEETS: Record<string, string> = {
  "__fixtures__/x.css": BAD_CSS,
  "src/app.css": APP_CSS,
  "src/bad.css": BAD_CSS,
  "src/unknown.css": UNKNOWN_CSS,
};

/** A Tailwind v4 entry with the import alone, so the theme is the tailwindcss package the kit resolves. */
export const TAILWIND_CSS = '@import "tailwindcss";\n';

/** A duplicate, a conflict, a hard-coded colour and an unknown class, on one attribute whose value starts at 2:25. */
export const BAD_CLASSES_TSX =
  'export function App() {\n  return <div className="flex flex p-2 p-4 text-[#ff0000] bg-foo-bar">x</div>;\n}\n';

/** Theme classes only, none repeated or in conflict. */
export const CLEAN_CLASSES_TSX = 'export function Clean() {\n  return <p className="flex p-4 text-red-500">ok</p>;\n}\n';

/** A committed, synced standards checkout holding `sheets`. */
export const cssKit = (sheets: Record<string, string> = SHEETS): string => consumer(sheets);

/**
 * A runner module in a temp dir whose `main` writes `stdout` and `stderr` and gives exit code `code`, in place of
 * Stylelint's.
 */
export function fakeRunner(run: { stdout: string; stderr: string; code: number }): string {
  const file = path.join(tempDir("workerstack-css-runner-"), "runner.ts");
  const body = [
    "export async function main(_argv: string[], out: (text: string) => void, err: (text: string) => void) {",
    `  out(${JSON.stringify(run.stdout)});`,
    `  err(${JSON.stringify(run.stderr)});`,
    `  return ${run.code};`,
    "}",
  ];
  fs.writeFileSync(file, `${body.join("\n")}\n`);
  return file;
}
