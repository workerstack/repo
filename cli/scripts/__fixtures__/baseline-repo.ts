/** Temp consumer roots for the lint baseline tests: git, the standards pack, and the tool configs sync writes. */
import { BASE_CONFIG } from "../../__fixtures__/base-config.ts";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { standards } from "../../sync/standards.ts";

export const SLOW = 60_000;
export const NN = "typescript(no-non-null-assertion)";
export const FLOAT = "typescript(no-floating-promises)";
export const PARAMS = "eslint(max-params)";
export const MAGIC = "repo(magic-number)";
/** A function returning a magic number, in `src/wait.ts` named after its export. */
export const WAIT = "export function wait(): number {\n  return 5000;\n}\n";

const temps: string[] = [];

export function cleanTemps(): void {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** `count` functions, each with one non-null assertion, the first named after the file `<stem>.ts` they go in. */
export const nonNull = (count: number, stem = "a") =>
  Array.from(
    { length: count },
    (_, i) => `export function ${stem}${i === 0 ? "" : i}(xs: string[]): string {\n  return xs.find(Boolean)!;\n}\n`,
  ).join("");
export const FLOATING = "export function start(load: () => Promise<void>): void {\n  load();\n}\n";

/** The two tool configs as sync writes them for the standards pack. */
function toolConfigs(): [string, string][] {
  const config = { packs: ["standards" as const], agents: { hosts: [], skills: [] }, ...BASE_CONFIG };
  const ctx = { root: "", config, workspace: { root: "", manifest: {}, packages: [] }, read: () => null };
  return standards(ctx, []).outputs.map((output): [string, string] => [
    output.path,
    output.kind === "file" ? output.content : "",
  ]);
}

/** A git consumer root with `packs`, the two tool configs as sync writes them, and `files`. */
export function consumer(files: Record<string, string>, packs = '["standards"]'): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-baseline-")));
  temps.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const all = {
    ...Object.fromEntries(toolConfigs()),
    "package.json": '{ "name": "app", "type": "module" }\n',
    "workerstack.config.ts": `export default { packs: ${packs} };\n`,
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
