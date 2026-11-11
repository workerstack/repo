import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { childEnv } from "../env.ts";
import { cleanTemps, PKG_ROOT, SLOW, tempDir } from "../scripts/fixtures/turn-repo.ts";
import { BAD_CLASSES_TSX, CLEAN_CLASSES_TSX, cssKit, TAILWIND_CSS } from "./fixtures/css-kit.ts";

afterEach(cleanTemps);

const AT = "src/app.tsx:2:25: error tailwindcss";
const CLASS_LINES = [
  `${AT}(no-conflicting-classes): "p-4" overrides "p-2" on "padding". "p-4" comes later in the generated stylesheet, ` +
    "so it wins no matter how the class attribute is ordered. Remove one.",
  `${AT}(no-duplicate-classes): Duplicate class: "flex". Removing the second occurrence.`,
  `${AT}(no-hardcoded-colors): "text-[#ff0000]" uses a hardcoded color value. ` +
    "Use a design token from your theme instead.",
  `${AT}(no-unknown-classes): "bg-foo-bar" is not a valid Tailwind class.`,
];

/** Where `tailwindcss` resolves from `dir`, through any links. */
function tailwindFrom(dir: string): string {
  return fs.realpathSync(Bun.resolveSync("tailwindcss", dir));
}

it("repo lint fails a Tailwind kit on its four bad classes, with no line for clean ones", { timeout: SLOW }, () => {
  const root = cssKit({
    "src/app.css": TAILWIND_CSS,
    "src/app.tsx": BAD_CLASSES_TSX,
    "src/clean.tsx": CLEAN_CLASSES_TSX,
  });
  // The entry's `@import "tailwindcss"` loads the copy this package installs beside oxlint-tailwindcss.
  expect(tailwindFrom(path.join(root, "src"))).toBe(tailwindFrom(PKG_ROOT));
  // oxlint prints to the bin's own stdout, so the command runs as a user runs it; the plugin's theme cache goes to a
  // temp dir the test removes, not the shared temp root.
  const env = childEnv({ OXLINT_TAILWINDCSS_CACHE_DIR: tempDir("workerstack-tailwind-cache-") });
  const bin = path.join(PKG_ROOT, "bin/repo.ts");
  const lint = spawnSync(process.execPath, [bin, "lint"], { cwd: root, encoding: "utf8", env });
  const output = `${lint.stdout}${lint.stderr}`;
  expect(lint.status, output).toBe(1);
  // Only the class lines: the temp kit has no tsconfig, so the type-aware rules say other things of its files.
  const lines = lint.stdout.split("\n").filter((line) => line.includes(" tailwindcss("));
  expect(lines.toSorted(), output).toStrictEqual(CLASS_LINES);
});
