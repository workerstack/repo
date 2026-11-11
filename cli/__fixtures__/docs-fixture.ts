import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import type { ExampleTools } from "../docs-examples.ts";
import type { DocsIo } from "../docs-io.ts";
import type { DocsTools } from "../docs-root.ts";

/** A temp folder holding `files` (relative path to text), removed when the test ends. */
export function tempRoot(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-docs-"));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** A markdown fence with the info string and body lines. */
export function fence(info: string, ...body: string[]): string {
  return ["```" + info, ...body, "```"].join("\n");
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

/** A successful tool run with no output. */
export const OK = { code: 0, stdout: "", stderr: "" };

/** What a `repo docs` run printed and which folders it synced. */
export type Run = { io: DocsIo; out: string[]; err: string[]; synced: string[] };

/** An io in `root` whose tools are `tools` over succeeding ones, and whose sync exits `sync`. */
export function docsRun(root: string, tools: Partial<DocsTools> = {}, sync = 0): Run {
  const out: string[] = [];
  const err: string[] = [];
  const synced: string[] = [];
  const io: DocsIo = {
    cwd: root,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    tools: { tsc: () => OK, bun: () => OK, pack: () => OK, ...tools },
    sync: (cwd) => {
      synced.push(cwd);
      return Promise.resolve(sync);
    },
  };
  return { io, out, err, synced };
}

/** A dry-run pack output holding `files`. */
export function packed(...files: string[]): typeof OK {
  return { ...OK, stdout: files.map((file) => `packed 1KB ${file}\n`).join("") };
}

/** A public package manifest that exports `exports` and the references. */
export function publicManifest(name: string, exports: Record<string, string>): string {
  return json({ name, private: false, exports: { ...exports, "./references/*": "./references/*" } });
}

/** A tool call an example check made. */
export type Call = { tool: "tsc" | "bun"; args: string[]; cwd: string };

/** Example tools that record their calls and answer each from `answer` over a successful run. */
export function exampleTools(answer: (call: Call) => Partial<typeof OK> = () => ({})): {
  calls: Call[];
  tools: ExampleTools;
} {
  const calls: Call[] = [];
  const run = (tool: Call["tool"]) => (args: string[], cwd: string) => {
    const call = { tool, args, cwd };
    calls.push(call);
    return { ...OK, ...answer(call) };
  };
  return { calls, tools: { tsc: run("tsc"), bun: run("bun") } };
}
