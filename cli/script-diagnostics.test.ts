import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { cleanTemps, hit, NAMES_NOTHING, NUMBER, plant, SLOW } from "./magic/fixtures/magic-repo.ts";
import { checkRejectionsAt, checkScriptsAt, scriptDiagnostics } from "./script-diagnostics.ts";

afterEach(cleanTemps);

const GUARD = "repo(guard-rejects)";
const UNTESTED = (name: string) =>
  `${name} is never asserted false; add expect(${name}(<an input it must reject>)).toBe(false) to a test`;

it("scriptDiagnostics joins the magic hits and the untested guards, in file and line order", { timeout: SLOW }, () => {
  const source =
    "export const isList = (value: unknown): value is unknown[] => Array.isArray(value);\nexport const n = (): number => 7;\n";
  const root = plant({ "src/a.ts": source });
  expect(scriptDiagnostics(root, ["src/a.ts"])).toStrictEqual({
    ok: true,
    value: [hit("src/a.ts:1:14", GUARD, UNTESTED("isList")), hit("src/a.ts:2:32", NUMBER, NAMES_NOTHING("7"))],
  });
});

it("scriptDiagnostics reports a tsconfig.json that only the guards read, over a test file", { timeout: SLOW }, () => {
  const root = plant({ "pkg/tsconfig.json": "{", "pkg/a.test.ts": "export {};\n" });
  const found = scriptDiagnostics(root, ["pkg/a.test.ts"]);
  expect(found.ok ? [] : found.errors).toStrictEqual([expect.stringMatching(/^pkg\/tsconfig\.json: .+/)]);
});

/** A git checkout with a config of `packs` and `skip`, and `files`. */
function checkout(files: Record<string, string>, config: object): string {
  const root = plant({ ...files, "workerstack.config.ts": `export default ${JSON.stringify(config)};\n` });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

it("checkScriptsAt gives every hit of the checkout and those its skips leave", async () => {
  const skip = { files: ["src/a.ts"], rules: ["repo/magic-number"], reason: "tuning lives here" };
  const root = checkout(
    { "src/a.ts": "export const f = () => 5000;\n", "src/b.ts": "export const g = () => 7;\n" },
    { packs: ["standards"], lint: { skip: [skip] } },
  );
  const a = hit("src/a.ts:1:24", NUMBER, NAMES_NOTHING("5000"));
  const b = hit("src/b.ts:1:24", NUMBER, NAMES_NOTHING("7"));
  expect(await checkScriptsAt(root)).toStrictEqual({ all: [a, b], kept: [b], problems: [] });
});

it("checkScriptsAt checks nothing without a config or the standards pack, and reports what stops it", async () => {
  const none = { all: [], kept: [], problems: [] };
  expect(await checkScriptsAt(plant({ "src/a.ts": "export const f = () => 5;\n" }))).toStrictEqual(none);
  const docs = checkout({ "src/a.ts": "export const f = () => 5;\n" }, { packs: ["docs"] });
  expect(await checkScriptsAt(docs)).toStrictEqual(none);
  const broken = checkout(
    { "pkg/tsconfig.json": "{", "pkg/a.ts": "export const f = () => 5;\n" },
    { packs: ["standards"] },
  );
  expect((await checkScriptsAt(broken)).problems).toStrictEqual([expect.stringMatching(/^pkg\/tsconfig\.json: .+/)]);
  const plain = plant({ "workerstack.config.ts": 'export default { packs: ["standards"] };\n' });
  expect((await checkScriptsAt(plain)).problems).toStrictEqual([expect.stringMatching(/^git ls-files failed: /)]);
});

it(
  "checkRejectionsAt checks every reject file of a standards checkout, and nothing without the pack",
  { timeout: SLOW },
  async () => {
    const files = {
      "src/a.reject.ts": "export const a: number = 'x';\n",
      "src/b.ts": "export const b: number = 'x';\n",
    };
    expect(await checkRejectionsAt(checkout(files, { packs: ["standards"] }))).toStrictEqual([
      "src/a.reject.ts: line 1 fails unmarked: TS2322: Type 'string' is not assignable to type 'number'.",
    ]);
    expect(await checkRejectionsAt(checkout(files, { packs: ["docs"] }))).toStrictEqual([]);
    expect(await checkRejectionsAt(plant(files))).toStrictEqual([]);
    const plain = plant({ "workerstack.config.ts": 'export default { packs: ["standards"] };\n' });
    expect(await checkRejectionsAt(plain)).toStrictEqual([expect.stringMatching(/^git ls-files failed: /)]);
  },
);
