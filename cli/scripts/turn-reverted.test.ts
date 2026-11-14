import { afterEach, expect, it } from "vitest";

import {
  cleanTemps,
  consumer,
  git,
  precommit,
  recording,
  SLOW,
  srcConfig,
  staged,
  TSCONFIG,
  turn,
  write,
} from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

const A = "export const a = 1;\n";
const B = "export const b = 1;\n";

/** A committed consumer whose root tsconfig covers `src`, plus `files`. */
function typed(files: Record<string, string>): string {
  return consumer({ "tsconfig.json": TSCONFIG, ...srcConfig(), ...files });
}

it("a whitespace edit fmt removes leaves no changes, and turn runs no later step", { timeout: SLOW }, async () => {
  const root = typed({ "src/a.ts": A });
  const { bins, calls } = recording(root);
  write(root, { "src/a.ts": "export const a = 1;   \n" });
  expect(await turn(root, [], bins)).toStrictEqual({
    code: 0,
    err: "",
    out: "turn: 1 file · fmt 1 fixed · no changes left\n",
  });
  expect(calls).toStrictEqual([]);
});

it("precommit drops a staged file fmt returned to HEAD and leaves nothing staged", { timeout: SLOW }, async () => {
  const root = typed({ "src/a.ts": A });
  const { bins, calls } = recording(root);
  write(root, { "src/a.ts": "export const a = 1;   \n" });
  git(root, "add", "src/a.ts");
  expect(await precommit(root, bins)).toStrictEqual({
    code: 0,
    err: "",
    out: "precommit: 1 file · fmt 1 fixed · no changes left\n",
  });
  expect(staged(root)).toStrictEqual([]);
  expect(calls).toStrictEqual([]);
});

it("a reverted file beside a real change: the later steps gate only the real one", { timeout: SLOW }, async () => {
  const root = typed({ "src/a.ts": A, "src/b.ts": B });
  const { bins, calls } = recording(root);
  write(root, { "src/a.ts": "export const a = 1;   \n", "src/b.ts": "export const b = 2;\n" });
  const result = await turn(root, [], bins);
  expect(result.out).toBe("turn: 2 files · fmt 1 fixed · comments ok · lint ok · typecheck .\n");
  expect(result.code).toBe(0);
  expect(calls).toStrictEqual(["tsc . --noEmit -p .", "tsc . --noEmit -p tsconfig.src.json"]);
});

const FIXED =
  "export function a(n: number) {\n  if (n > 0) {\n    const next = n + 1;\n\n    return next;\n" +
  "  }\n\n  return 0;\n}\n";

const ELSE =
  "export function a(n: number) {\n  if (n > 0) {\n    const next = n + 1;\n\n    return next;\n" +
  "  } else {\n    return 0;\n  }\n}\n";

it("an else lint --fix turns back into the committed text leaves no changes", { timeout: SLOW }, async () => {
  const root = typed({ "src/a.ts": FIXED });
  const { bins, calls } = recording(root);
  write(root, { "src/a.ts": ELSE });
  expect(await turn(root, [], bins)).toStrictEqual({
    code: 0,
    err: "",
    out: "turn: 1 file · fmt ok · comments ok · lint ok · no changes left\n",
  });
  expect(calls).toStrictEqual([]);
});

it("a new untracked file fmt fixes stays in the change set", { timeout: SLOW }, async () => {
  const root = typed({});
  const { bins, calls } = recording(root);
  write(root, { "src/c.ts": "export const c = {d:1}\n" });
  const result = await turn(root, [], bins);
  expect(result.out).toBe("turn: 1 file · fmt 1 fixed · comments ok · lint ok · typecheck .\n");
  expect(calls).toStrictEqual(["tsc . --noEmit -p .", "tsc . --noEmit -p tsconfig.src.json"]);
});

const WORKSPACE = { name: "app", private: true, type: "module", workspaces: ["packages/*"] };

const API_MANIFEST = '{\n  "name": "api",\n  "private": true,\n  "type": "module",\n  "sideEffects": false\n}\n';

it("a path gates every file of its package, a reverted one too", { timeout: SLOW }, async () => {
  const root = consumer({
    "package.json": `${JSON.stringify(WORKSPACE, null, 2)}\n`,
    "packages/api/package.json": API_MANIFEST,
    "packages/api/src/a.ts": A,
    "packages/api/tsconfig.json": TSCONFIG,
    ...srcConfig("packages/api"),
  });

  const { bins, calls } = recording(root);
  write(root, { "packages/api/src/a.ts": "export const a = 1;   \n" });
  const result = await turn(root, ["packages/api/src"], bins);
  expect(result.out).toMatch(/ · fmt 1 fixed · comments ok · lint ok · typecheck packages\/api · /);
  expect(calls).toContain("tsc . --noEmit -p packages/api");
});
