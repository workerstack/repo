import { afterEach, expect, it } from "vitest";
import { commentsStep } from "./comments-step.ts";
import type { Change } from "./change-set.ts";
import { cleanTemps, consumer, SLOW, tempDir, turn, write } from "./fixtures/turn-repo.ts";
import type { Bins } from "./turn-steps.ts";

afterEach(cleanTemps);

const IGNORE = '"@ts-ignore" hides a type error; fix the type, or write @ts-expect-error with a reason';
const PIN = `bun@${Bun.version}`;
const APP_MANIFEST = `${JSON.stringify({ name: "app", type: "module", private: true, sideEffects: false, packageManager: PIN })}\n`;
const UNUSED: Bins = { tsc: () => ({ code: 1, stdout: "", stderr: "" }), vitest: () => null };

/** The comments step over `files` written to a temp root, each changed, or deleted when listed in `deleted`. */
function step(files: Record<string, string>, deleted: readonly string[] = []) {
  const root = tempDir("workerstack-comments-step-");
  write(root, files);
  const changes: Change[] = Object.keys(files).map((rel) => ({ rel, deleted: deleted.includes(rel), owner: "" }));
  return commentsStep({ root, changes, packages: [], bins: UNUSED, skips: [] });
}

it("passes files with no refused comment", () => {
  expect(step({ "src/a.ts": '// @ts-expect-error "lint" is not a pack\n', "README.md": "// @ts-ignore\n" })).toEqual({
    label: "comments ok",
    ok: true,
    output: [],
    touched: [],
  });
});

it("fails on each refused comment, naming its file and line", () => {
  expect(step({ "src/a.ts": "export const a = 1;\n// @ts-ignore\n" })).toEqual({
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
    write(root, { "src/a.ts": "export const a = 1;\n// @ts-ignore\n", "package.json": APP_MANIFEST });
    const result = await turn(root, []);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^turn: 2 files · fmt [^·]+ · comments 1 refused · .* · check failed\n$/);
    expect(result.err).toContain(`src/a.ts:2: ${IGNORE}\n`);
    expect(result.err).toContain(`repo check: src/a.ts:2: ${IGNORE}\n`);
  },
);
