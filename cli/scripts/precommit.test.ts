import { afterEach, expect, it } from "vitest";

import {
  APP_MANIFEST,
  cleanTemps,
  consumer,
  git,
  OK,
  precommit,
  read,
  SLOW,
  srcConfig,
  staged,
  TSCONFIG,
  unstaged,
  write,
} from "./__fixtures__/turn-repo.ts";
import type { Captured } from "./lint.ts";
import type { Bins } from "./turn-steps.ts";

afterEach(cleanTemps);

it("precommit refuses a file with staged and unstaged changes before running anything", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" });
  write(root, { "src/a.ts": "export const a = {b:1}\n" });
  git(root, "add", "src/a.ts");
  write(root, { "src/a.ts": "export const a = {b:2}\n" });
  expect(await precommit(root)).toStrictEqual({
    code: 1,
    err: "repo precommit: src/a.ts has staged and unstaged changes; stage the rest (git add src/a.ts) or undo it\n",
    out: "",
  });
  expect(read(root, "src/a.ts")).toBe("export const a = {b:2}\n");
});

it("precommit restages what fmt fixed, and an unstaged file stays out", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
  write(root, { "src/a.ts": "export const a = {b:1}\n", "src/b.ts": "export const b = {c:1}\n" });
  git(root, "add", "src/a.ts");
  const result = await precommit(root);
  expect(result.out).toMatch(/^precommit: 1 file · fmt 1 fixed · comments ok · lint ok · /);
  expect(result.code).toBe(0);
  expect(staged(root)).toStrictEqual(["src/a.ts"]);
  expect(unstaged(root)).toStrictEqual(["src/b.ts"]);
  expect(git(root, "show", ":src/a.ts")).toBe("export const a = { b: 1 };\n");
  expect(read(root, "src/b.ts")).toBe("export const b = {c:1}\n");
});

it("precommit restages what lint --fix and sync rewrote, the fix formatted", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" });
  const attributes = read(root, ".gitattributes");
  write(root, {
    // A line dropped from the region comes back; one added there would be moved below it.
    ".gitattributes": `${attributes}*.bin binary\n`.replace("bunfig.toml linguist-generated\n", ""),
    "package.json": APP_MANIFEST,
    "src/a.ts": [
      "export function a(n: number) {\n  if (n > 0) {\n    const next = n + 1;\n\n    return next;\n",
      "  } else {\n    return 0;\n  }\n}\n",
    ].join(""),
  });
  git(root, "add", "src/a.ts", "package.json", ".gitattributes");
  const result = await precommit(root);
  expect(result.out).toMatch(
    /^precommit: 3 files · fmt 1 fixed · comments ok · lint ok · .* · sync ok · 0 related tests · check ok\n$/,
  );
  expect(git(root, "show", ":src/a.ts")).toBe(
    "export function a(n: number) {\n  if (n > 0) {\n    const next = n + 1;\n\n    return next;\n" +
      "  }\n\n  return 0;\n}\n",
  );
  expect(git(root, "show", ":.gitattributes")).toBe(`${attributes}*.bin binary\n`);
  expect(unstaged(root)).toStrictEqual([]);
});

it("a failing typecheck and failing tests print their output and fail precommit", { timeout: SLOW }, async () => {
  const root = consumer({ "tsconfig.json": TSCONFIG, ...srcConfig(), "src/a.ts": "export const a = 42;\n" });
  write(root, { "src/a.ts": "export const a = 41;\n" });
  git(root, "add", "src/a.ts");

  const bins: Bins = {
    tsc: (args): Captured =>
      args.includes("tsconfig.src.json") ? OK : { code: 2, stderr: "", stdout: "src/a.ts(1,7): error TS2322: no.\n" },
    vitest: (): Captured => ({ code: 1, stderr: "", stdout: " Tests  1 failed | 3 passed (4)\n" }),
  };

  const result = await precommit(root, bins);
  expect(result.out).toBe(
    "precommit: 1 file · fmt ok · comments ok · lint ok · typecheck failed (tsconfig.json) · " +
      "4 related tests, 1 failed\n",
  );
  expect(result.err).toBe("src/a.ts(1,7): error TS2322: no.\n Tests  1 failed | 3 passed (4)\n");
  expect(result.code).toBe(1);
});
