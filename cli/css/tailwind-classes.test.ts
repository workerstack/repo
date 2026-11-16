import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { childEnv } from "../env.ts";
import { cleanTemps, PKG_ROOT, SLOW, tempDir } from "../scripts/__fixtures__/turn-repo.ts";
import { BAD_CLASSES_TSX, CLEAN_CLASSES_TSX, cssKit, VARS_CSS, VARS_ENTRY_CSS } from "./__fixtures__/css-kit.ts";

afterEach(cleanTemps);

const AT = "src/app.tsx:2:25: ";
const AT_PIECED = "src/app.tsx:7:48: ";

function rule(name: string): string {
  return ` [Error/tailwindcss(${name})]`;
}

const HARDCODED = '"text-[#ff0000]" uses a hardcoded color value. Use a design token from your theme instead.';

/** The var rule's message for `name`, which no sheet of the kit's entry defines, and its rule tag. */
function undefinedVar(name: string): string {
  return (
    `"${name}" is not defined by src/app.css or a sheet it imports. Fix the name, define it in a sheet, ` +
    `or list it in lint.tailwind.vars when code sets it at runtime. [Error/repo(no-undefined-var)]`
  );
}

const PIECED_TEXT =
  '"bg-${x}" is built at runtime, so Tailwind never sees it written out and generates no CSS for it. ' +
  "Write out the full class names (for example, a map from each value to its class) instead.";

const PIECED = `${AT_PIECED}${PIECED_TEXT}${rule("no-dynamic-classes")}`;

const CLASS_LINES = [
  `${AT}"bg-foo-bar" is not a valid Tailwind class.${rule("no-unknown-classes")}`,
  `${AT}"p-4" overrides "p-2" on "padding". "p-4" comes later in the generated stylesheet, ` +
    `so it wins no matter how the class attribute is ordered. Remove one.${rule("no-conflicting-classes")}`,
  `${AT}${HARDCODED}${rule("no-hardcoded-colors")}`,
  `${AT}Duplicate class: "flex". Removing the second occurrence.${rule("no-duplicate-classes")}`,
  `src/app.tsx:5:32: ${undefinedVar("--ui-nope")}`,
  `src/app.tsx:6:27: ${undefinedVar("--ui-nope")}`,
  PIECED,
];

/** Where `tailwindcss` resolves from `dir`, through any links. */
function tailwindFrom(dir: string): string {
  return fs.realpathSync(Bun.resolveSync("tailwindcss", dir));
}

it("repo lint fails a Tailwind kit on its bad classes and vars, with no line for clean ones", { timeout: SLOW }, () => {
  const root = cssKit({
    "src/app.css": VARS_ENTRY_CSS,
    "src/app.tsx": BAD_CLASSES_TSX,
    "src/clean.tsx": CLEAN_CLASSES_TSX,
    "src/vars.css": VARS_CSS,
  });

  // The entry's `@import "tailwindcss"` loads the copy this package installs beside oxlint-tailwindcss.
  expect(tailwindFrom(path.join(root, "src"))).toBe(tailwindFrom(PKG_ROOT));

  // oxlint prints to the bin's own stdout, so the command runs as a user runs it; the plugin's theme cache goes to a
  // temp dir the test removes, not the shared temp root. oxlint picks its own format from the environment (GitHub
  // annotations in Actions, a compact one under an AI agent), so the test names one. DEBUG makes oxlint-tailwindcss
  // log the stylesheet it loaded and the files mapped to it to stderr, which a failure shows with the kit's config.
  const env = childEnv({
    DEBUG: "oxlint-tailwindcss",
    OXLINT_TAILWINDCSS_CACHE_DIR: tempDir("workerstack-tailwind-cache-"),
  });

  const bin = path.join(PKG_ROOT, "bin/repo.ts");
  const lint = spawnSync(process.execPath, [bin, "lint", "-f", "unix"], { cwd: root, encoding: "utf8", env });
  const config = fs.readFileSync(path.join(root, ".oxlintrc.jsonc"), "utf8");
  const output = [lint.stdout, lint.stderr, config].join("\n");
  expect(lint.status, output).toBe(1);
  // Only the class and var lines: the temp kit has no tsconfig, so the type-aware rules say other things of its files.
  const lines = lint.stdout.split("\n").filter((line) => /\/tailwindcss\(|repo\(no-undefined-var\)/.test(line));
  expect(lines.toSorted(), output).toStrictEqual(CLASS_LINES);
});
