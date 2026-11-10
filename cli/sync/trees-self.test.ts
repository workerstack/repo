import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import { HOSTS } from "../config.ts";
import { runSync } from "../sync.ts";
import { renderTrees } from "./trees.ts";
import { bunPath, linkText } from "../../dev/test-paths.ts";
import {
  RENDER_TIMEOUT,
  SELF_ROOT,
  STOCK_SKILL,
  consumer,
  context,
  linkTarget,
  stagesIn,
} from "./fixtures/trees-kit.ts";
import { put, useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: RENDER_TIMEOUT });

const CLAUDE_CONFIG = 'export default { agents: { hosts: ["claude"] } }\n';

/** A bun script that renders this repo six times and prints each distinct path list it saw. */
function renderSixTimes(): string {
  const trees = pathToFileURL(path.join(SELF_ROOT, "cli", "sync", "trees.ts")).href;
  return `
      const { renderTrees } = await import(${JSON.stringify(trees)});
      const seen = new Set();
      for (let i = 0; i < 6; i++) {
        const result = renderTrees({
          root: ${JSON.stringify(SELF_ROOT)},
          config: { packs: ["agents"], agents: { hosts: ${JSON.stringify(HOSTS)}, skills: [] } },
          workspace: { root: ${JSON.stringify(SELF_ROOT)}, manifest: { name: "@workerstack/repo" }, packages: [] },
          read: () => null,
        });
        seen.add(result.ok ? result.outputs.map((output) => output.path).join(",") : result.errors.join("\\n"));
      }
      process.stdout.write(JSON.stringify([...seen]));`;
}

/** The stdout of a bun child running `script` in this repo. */
const child = (script: string) =>
  new Promise<string>((resolve, reject) => {
    const proc = spawn(bunPath(), ["-e", script], { cwd: SELF_ROOT, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    proc.stdout.on("data", (chunk) => (out += String(chunk)));
    proc.on("error", reject);
    proc.on("close", () => resolve(out));
  });

async function sync(root: string, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSync(args, { cwd: root, stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

it("keeps every output tracked and links skills inside the repo", () => {
  const result = renderTrees({
    ...context(SELF_ROOT, HOSTS, { skills: ["google-workspace", "listen", "speak", "clasp"] }),
    workspace: { root: SELF_ROOT, manifest: { name: "@workerstack/repo" }, packages: [] },
  });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  expect(result.outputs.every((output) => output.tracked)).toBe(true);
  expect(linkTarget(result.outputs, ".claude/skills/ask")).toBe("../../agents/skills/ask");
  expect(linkTarget(result.outputs, ".agents/skills/ask")).toBe("../../agents/skills/ask");
});

it("renders the same files while other processes render the same root", async () => {
  const script = renderSixTimes();
  const results = await Promise.all([child(script), child(script), child(script), child(script)]);
  expect(new Set(results).size).toBe(1);
  expect(JSON.parse(results[0])).toHaveLength(1);
});

it("regenerates the committed trees byte for byte", async () => {
  const out: string[] = [];
  const code = await runSync(["--check"], { cwd: SELF_ROOT, stdout: (s) => out.push(s), stderr: (s) => out.push(s) });
  expect(out.join("")).toBe("repo sync: up to date\n");
  expect(code).toBe(0);
});

it("replaces a dangling skill link left by a removed node_modules instead of following it", async () => {
  const root = consumer();
  put(root, "workerstack.config.ts", CLAUDE_CONFIG);
  fs.mkdirSync(path.join(root, ".claude", "skills"), { recursive: true });
  fs.symlinkSync("../../gone/ask", path.join(root, ".claude", "skills", "ask"), "dir");

  expect((await sync(root)).code).toBe(0);
  const link = path.join(root, ".claude", "skills", "ask");
  // A win32 junction reads back as the absolute path it resolved to, so it is the target that is compared there.
  const stock = path.resolve(path.dirname(link), `${STOCK_SKILL}/ask`);
  expect(fs.realpathSync(link)).toBe(fs.realpathSync(stock));
  expect(process.platform === "win32" ? "" : linkText(link)).toBe(
    process.platform === "win32" ? "" : `${STOCK_SKILL}/ask`,
  );
  expect(fs.existsSync(path.join(link, "SKILL.md"))).toBe(true);
  expect(fs.existsSync(path.join(root, "gone"))).toBe(false);
  expect(await sync(root, "--check")).toEqual({ code: 0, stdout: "repo sync: up to date\n", stderr: "" });
});

it("reports a failed render and leaves no stage behind", async () => {
  const root = consumer({ ".repo/settings/claude.json": "{" });
  put(root, "workerstack.config.ts", CLAUDE_CONFIG);
  const result = await sync(root);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(".repo/settings/claude.json");
  expect(stagesIn(root)).toEqual([]);
  expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);
});

it("fails on a .repo subagent with broken frontmatter, naming the file", async () => {
  const root = consumer({ ".repo/subagents/bad.md": "---\nname: [unclosed\n---\nbody\n" });
  put(root, "workerstack.config.ts", CLAUDE_CONFIG);
  const result = await sync(root);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("sync: .repo/subagents/bad.md: invalid frontmatter: ");
});
