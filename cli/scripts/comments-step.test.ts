import { afterEach, expect, it } from "vitest";

import type { Change } from "./change-set.ts";
import { commentsStep } from "./comments-step.ts";
import { cleanTemps, consumer, SLOW, tempDir, turn, write } from "./fixtures/turn-repo.ts";
import type { Bins } from "./turn-steps.ts";

afterEach(cleanTemps);

const IGNORE = '"@ts-ignore" hides a type error; fix the type, or write @ts-expect-error with a reason';
const PIN = `bun@${Bun.version}`;
const APP_MANIFEST = `${JSON.stringify({ name: "app", packageManager: PIN, private: true, sideEffects: false, type: "module" })}\n`;
const UNUSED: Bins = { tsc: () => ({ code: 1, stderr: "", stdout: "" }), vitest: () => null };

/** The comments step over `files` written to a temp root, each changed, or deleted when listed in `deleted`. */
function step(files: Record<string, string>, deleted: readonly string[] = []) {
  const root = tempDir("workerstack-comments-step-");
  write(root, files);
  const changes: Change[] = Object.keys(files).map((rel) => ({ deleted: deleted.includes(rel), owner: "", rel }));
  return commentsStep({ bins: UNUSED, changes, packages: [], root, skips: [] });
}

it("passes files with no refused comment", () => {
  expect(
    step({ "README.md": "// @ts-ignore\n", "src/a.ts": '// @ts-expect-error "lint" is not a pack\n' }),
  ).toStrictEqual({
    label: "comments ok",
    ok: true,
    output: [],
    touched: [],
  });
});

it("fails on each refused comment, naming its file and line", () => {
  expect(step({ "src/a.ts": "export const a = 1;\n// @ts-ignore\n" })).toStrictEqual({
    label: "comments 1 refused",
    ok: false,
    output: [`src/a.ts:2: ${IGNORE}\n`],
    touched: [],
  });
});

it("skips a file the change deletes, though it is still on disk, as after git rm --cached", () => {
  expect(step({ "src/a.ts": "// @ts-ignore\n" }, ["src/a.ts"])).toMatchObject({ label: "comments ok", ok: true });
});

it(
  "runs after fmt, and a turn that also runs check prints the refused line again under check failed",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "src/a.ts": "export const a = 1;\n" });
    write(root, { "package.json": APP_MANIFEST, "src/a.ts": "export const a = 1;\n// @ts-ignore\n" });
    const result = await turn(root, []);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^turn: 2 files · fmt [^·]+ · comments 1 refused · .* · check failed\n$/);
    expect(result.err).toContain(`src/a.ts:2: ${IGNORE}\n`);
    expect(result.err).toContain(`repo check: src/a.ts:2: ${IGNORE}\n`);
  },
);
