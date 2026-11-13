import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { standardsFiles } from "../__fixtures__/standards-files.ts";
import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { captureTool, fmt, runTool } from "./lint.ts";

const SLOW = 60_000;

const tree = useTempTree("workerstack-bun-fmt-");

/** A package.json whose `fmt` script exits 7: what `bun fmt` runs in place of formatting, without `--no-script`. */
const FMT_SCRIPT = `{ "name": "app", "scripts": { "fmt": "sh -c 'exit 7'" }, "type": "module" }\n`;

/** A consumer with the standards configs sync writes, a package.json `fmt` script, and `files`. */
function consumer(files: Record<string, string>): string {
  const config = { "package.json": FMT_SCRIPT, "repo.config.ts": 'export default { packs: ["standards"] };\n' };

  return tree({ ...standardsFiles(), ...config, ...files });
}

/** Every file under `root`, relative path to content. */
function snapshot(root: string): Record<string, string> {
  const entries = fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const files = entries.map((entry) => path.join(entry.parentPath, entry.name));

  return Object.fromEntries(files.map((file) => [path.relative(root, file), fs.readFileSync(file, "utf8")]));
}

/** A stderr that keeps what is written to it. */
function capture() {
  const err: string[] = [];

  return { err, stderr: (s: string) => err.push(s) };
}

describe("bun fmt, past a package.json fmt script", () => {
  it("runTool gives bun fmt's own verdict: 0 on a clean file, 1 on an unformatted one", { timeout: SLOW }, async () => {
    const clean = consumer({ "src/b.ts": "export const a = { b: 1 };\n" });
    const messy = consumer({ "src/b.ts": "export const a = {b:1}\n" });
    const io = capture();
    expect(await runTool("bun fmt", ["--check", "src/b.ts"], { cwd: clean, stderr: io.stderr })).toBe(0);
    expect(await runTool("bun fmt", ["--check", "src/b.ts"], { cwd: messy, stderr: io.stderr })).toBe(1);
  });

  it("captureTool formats the file it is given", { timeout: SLOW }, () => {
    const root = consumer({ "src/b.ts": "export const a = {b:1}\n" });
    expect(captureTool("bun fmt", ["src/b.ts"], root).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "src/b.ts"), "utf8")).toBe("export const a = { b: 1 };\n");
  });
});

it(
  "fmt refuses --init, which would write a [fmt] section into the bunfig.toml sync owns",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "bunfig.toml": "[install]\nexact = true\n" });
    const before = snapshot(root);
    const io = capture();
    expect([await fmt(["--init"], { cwd: root, stderr: io.stderr }), io.err]).toStrictEqual([
      1,
      ["repo fmt: --init writes bunfig.toml, which repo sync owns; edit .oxfmtrc.jsonc\n"],
    ]);
    expect(snapshot(root)).toStrictEqual(before);
  },
);

it("fmt prints the --init refusal to the process stderr when given none", async () => {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  onTestFinished(() => write.mockRestore());
  expect(await fmt(["--init"])).toBe(1);
  expect(write.mock.calls).toStrictEqual([
    ["repo fmt: --init writes bunfig.toml, which repo sync owns; edit .oxfmtrc.jsonc\n"],
  ]);
});
