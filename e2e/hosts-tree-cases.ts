/** The hosts suite's cases for hosts that only get files generated, and for a linked worktree with no install. */
import fs from "node:fs";
import path from "node:path";

import { beforeAll, expect, inject, it } from "vitest";

import { isRecord, isString } from "../cli/json.ts";
import { readManifest } from "../cli/sync/manifest.ts";
import type { Output } from "../cli/sync/outputs.ts";
import { validateOutputs } from "../cli/sync/validate-outputs.ts";
import { installedBin } from "../dev/test-paths.ts";
import type { GetSandbox } from "./get-sandbox.types";
import { commands, expectClean, GATE, MAP, only, output, ROOT_VARS, runHook } from "./hosts-kit";
import type { Sandbox } from "./sandbox";

/** Each generated-only host, the dir it owns, the paths sync must write for it and the other hosts' dirs. */
const GENERATED_HOSTS = [
  {
    expected: [".grok/config.toml", ".grok/hooks/rtk.json", ".grok/roles"],
    host: "grok",
    others: [".claude", ".codex", ".cursor"],
    owns: ".grok/",
  },
  { expected: [".cursor/hooks.json"], host: "cursor", others: [".claude", ".codex", ".grok"], owns: ".cursor/" },
  {
    expected: [".agents/hooks.json"],
    host: "antigravity",
    others: [".claude", ".codex", ".grok", ".cursor"],
    owns: ".agents/",
  },
];

/** The linked worktree and the main checkout it hangs off, set by the worktree block's beforeAll. */
type Tree = { main: string; wt: string };

/** Every file and link sync planned for the host, read back from disk as the outputs validation checks. */
function planned(sb: Sandbox): Output[] {
  return readManifest(sb.repo).paths.flatMap((rel): Output[] => {
    const abs = path.join(sb.repo, rel);
    const stat = fs.lstatSync(abs, { throwIfNoEntry: false });
    expect(stat, `${rel} was planned but is missing`).toBeDefined();

    if (stat?.isSymbolicLink() === true)
      return [{ kind: "link", managed: "whole", path: rel, target: fs.readlinkSync(abs), tracked: false }];

    if (stat?.isFile() === true)
      return [{ content: fs.readFileSync(abs, "utf8"), kind: "file", managed: "whole", path: rel, tracked: false }];

    return [];
  });
}

/** Sync with one generated-only host writes every planned file, and each passes validateOutputs. */
export function generatedHostCases(get: GetSandbox) {
  it.each(GENERATED_HOSTS)(
    "$host: sync with only that host writes every planned file, and each passes validateOutputs",
    async ({ host, owns, others, expected }) => {
      const sb = get();
      const config = sb.read("repo.config.ts");
      sb.write("repo.config.ts", config.replace(/hosts: \[[^\]]*\]/, `hosts: ${JSON.stringify([host])}`));

      try {
        expectClean(sb, await sb.run("bun", ["repo", "sync"], { env: ROOT_VARS }));
        const outputs = planned(sb);
        const own = outputs.filter((o) => o.path.startsWith(owns));
        expect(own.length, `${host} planned files`).toBeGreaterThan(0);

        for (const rel of expected)
          expect(sb.exists(rel) || own.some((o) => o.path.startsWith(`${rel}/`)), rel).toBe(true);

        for (const rel of others) expect(sb.exists(rel), rel).toBe(false);
        expect(validateOutputs(sb.repo, outputs)).toStrictEqual([]);
        expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"], { env: ROOT_VARS }));
      } finally {
        sb.write("repo.config.ts", config);
        await sb.run("bun", ["repo", "sync"], { env: ROOT_VARS });
      }
    },
  );
}

/** In the worktree, SessionStart names the main checkout's bin once and still gives the map. */
function worktreeSessionCase(get: GetSandbox, tree: Tree) {
  it("SessionStart says which bin runs, once, and still gives the map", async () => {
    const sb = get();
    const { main, wt } = tree;

    const command = only(
      commands(sb, ".claude/settings.json", { ends: MAP, event: "SessionStart" }),
      "claude session-map",
    );

    const r = await runHook(sb, command, {
      cwd: wt,
      env: { CLAUDE_PROJECT_DIR: wt },
      payload: { cwd: wt, hook_event_name: "SessionStart", session_id: "wt-e2e", source: "startup" },
    });

    expectClean(sb, r);
    const { additionalContext } = output(r);
    const context = isString(additionalContext) ? additionalContext : "";
    expect(
      context.startsWith(
        // The notice names the bin as the platform spells a path; a rewritten command uses forward slashes.
        `repo: hooks run ${path.normalize(installedBin(main))} (this worktree has no install); ` +
          "run `bun install` here to use its own code\n",
      ),
    ).toBe(true);
    expect(context.split("hooks run").length).toBe(2);
    expect(context).toContain("src/");
  });
}

/** In the worktree, the gate rewrites through the main checkout's bin but keeps the worktree's paths. */
function worktreeGateCase(get: GetSandbox, tree: Tree) {
  it("the gate rewrites through the main checkout's bin with the worktree's paths", async () => {
    const sb = get();
    const { main, wt } = tree;
    const command = only(commands(sb, ".claude/settings.json", { ends: GATE, event: "PreToolUse" }), "claude gate");

    const r = await runHook(sb, command, {
      cwd: wt,
      env: { CLAUDE_PROJECT_DIR: wt },
      payload: {
        cwd: wt,
        hook_event_name: "PreToolUse",
        session_id: "wt-e2e",
        tool_input: { command: `cat ${wt}/src/index.ts` },
        tool_name: "Bash",
      },
    });

    expectClean(sb, r);
    const updated = output(r).updatedInput;
    const written = isRecord(updated) ? updated.command : "";
    const rewritten = isString(written) ? written : "";
    expect(rewritten.startsWith(`${installedBin(main)} job --job exec --query `), rewritten).toBe(true);
    expect(rewritten).toContain(`${wt}/src/index.ts`);
    expect(rewritten).not.toContain(`${main}/src/index.ts`);
  });
}

/** A hook with no install anywhere fails and says to run bun install. */
function noInstallCase(get: GetSandbox) {
  it("a hook with no install anywhere still says to run bun install", async () => {
    const sb = get();
    const bare = fs.mkdtempSync(path.join(inject("runRoot"), "bare-"));

    const command = only(
      commands(sb, ".claude/settings.json", { ends: MAP, event: "SessionStart" }),
      "claude session-map",
    );

    const r = await runHook(sb, command, {
      cwd: bare,
      env: { CLAUDE_PROJECT_DIR: bare },
      payload: { cwd: bare, session_id: "x" },
    });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`repo: ${fs.realpathSync(bare)}/node_modules/.bin/repo is missing; run bun install`);
  });
}

/** A linked worktree with no install of its own, outside the sandbox root as T3 Code makes them. */
export function worktreeCases(get: GetSandbox) {
  const tree: Tree = { main: "", wt: "" };
  beforeAll(async () => {
    const sb = get();
    tree.main = fs.realpathSync(sb.repo);
    await sb.commit("hosts");
    // Outside the sandbox root, where T3 Code puts its worktrees.
    tree.wt = path.join(fs.realpathSync(fs.mkdtempSync(path.join(inject("runRoot"), "t3-"))), "worktrees", "fix-x");
    await sb.git("worktree", "add", "-q", "-b", "fix-x", tree.wt);
    expect(fs.existsSync(path.join(tree.wt, "node_modules"))).toBe(false);
  });
  worktreeSessionCase(get, tree);
  worktreeGateCase(get, tree);
  noInstallCase(get);
}
