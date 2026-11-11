/** Planted repos and spies for the tests of what `repo lint` prints beyond oxlint's own output. */
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { consumer } from "./baseline-repo.ts";

/** A comparison of an untyped string, at line 2 column 16. */
export const STRING_SOURCE = 'export function a(m: string): boolean {\n  return m === "fast";\n}\n';
export const STRING_HIT = `src/a.ts:2:16: error repo(magic-string): "fast" is compared to a plain string; type the value as a literal union or brand, or import the string from a *.constants.ts file`;
export const CLEAN_SOURCE = "export const b = 1;\n";
export const GUARD_SOURCE =
  "export function isUser(value: unknown): value is string[] {\n  return Array.isArray(value);\n}\n";
export const GUARD_HIT =
  "src/is-user.ts:1:17: error repo(guard-rejects): isUser is never asserted false; add expect(isUser(<an input it must reject>)).toBe(false) to a test";
/** A test that imports the guard and only asserts it true, with a typed local `expect` so no vitest is needed. */
export const GUARD_TEST =
  'import { isUser } from "./is-user.ts";\n\nfunction expect(value: unknown) {\n  return { toBe: (want: unknown): boolean => value === want };\n}\n\nexpect(isUser([])).toBe(true);\n';

/** A repo with the magic string in `src/a.ts` and a clean `src/b.ts`. */
export const planted = (): string => consumer({ "src/a.ts": STRING_SOURCE, "src/b.ts": CLEAN_SOURCE });

/** Writes the config with a `lint.skip` entry for `rule` in `file`. */
export function skipIn(root: string, file: string, rule: string): void {
  const skip = { files: [file], rules: [rule], reason: "kept on purpose" };
  const config = { packs: ["standards"], lint: { skip: [skip] } };
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), `export default ${JSON.stringify(config)};\n`);
}

/** Spies on stdout and stderr; `lines` is what each was asked to print, one string per write. */
export function spies() {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const texts = (spy: typeof out) => spy.mock.calls.map(([text]) => String(text)).filter(Boolean);
  return { stdout: () => texts(out), stderr: () => texts(err), clear: () => (out.mockClear(), err.mockClear()) };
}
