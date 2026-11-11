/**
 * The published package, end to end: launch it the way users do (bunx) from a real
 * registry into real consumer repos, then use what it installed. Init copies nothing:
 * `bun install` runs `repo sync` (postinstall), which generates the gitignored agent trees.
 */
import fs from "node:fs";
import path from "node:path";

import { parse } from "jsonc-parser";
import { beforeAll, describe, expect, inject, it } from "vitest";

import { readEnv } from "../cli/env.ts";
import { nodelessPath } from "../dev/nodeless-path.ts";
import { installedBin } from "../dev/test-paths.ts";
import {
  claudeGate,
  expectClean,
  expectGatesPass,
  expectPlantedFails,
  expectSkipsChecked,
  FLOATING,
  GENERATED,
  generatedHashes,
  hashes,
  hookCalls,
  hookPayloads,
  ignoredFiles,
  installedVersion,
  isPackageJson,
  NON_NULL,
  removeGenerated,
  setHosts,
} from "./init-helpers";
import { PACKAGE_NAME } from "./registry";
import { BROKEN_RUNTIME, Sandbox, tail } from "./sandbox";

const version = inject("version");
const registryUrl = inject("registryUrl");

describe("bunx", () => {
  describe("fresh repo", () => {
    let sb: Sandbox;

    beforeAll(async () => {
      sb = new Sandbox("fresh");
      await sb.scaffold();
      expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
    });

    it("installs this exact build as a devDependency", async () => {
      expect(await installedVersion(sb)).toBe(version);
      expect(JSON.stringify(sb.json("package.json", isPackageJson).devDependencies)).toContain(version);
    });

    it("init copies nothing: it writes the config and a postinstall, and install generates the trees", () => {
      expect(sb.exists("workerstack.config.ts")).toBe(true);
      expect(sb.json("package.json", isPackageJson).scripts.postinstall).toBe("repo sync --postinstall");
      for (const rel of [".rulesync", "scripts"]) expect(sb.exists(rel), rel).toBe(false);
      for (const rel of GENERATED) expect(sb.exists(rel), rel).toBe(true);
      for (const rel of ["CLAUDE.md", "GEMINI.md", ".gemini"]) expect(sb.exists(rel), rel).toBe(false);
      expect(fs.existsSync(path.join(sb.home, ".grok", "config.toml"))).toBe(true);
      const scripts = sb.json("package.json", isPackageJson).scripts;
      expect(Object.keys(scripts).filter((k) => k.startsWith("repo:"))).toStrictEqual([]);
    });

    it("writes private, sideEffects and a pinned bun, so repo check passes", async () => {
      const pkg = sb.json("package.json", (v): v is Record<string, unknown> => typeof v === "object" && v !== null);
      expect(pkg).toMatchObject({ private: true, sideEffects: false });
      expect(pkg.packageManager).toMatch(/^bun@\d+\.\d+\.\d+/);
      expectClean(sb, await sb.run("bun", ["repo", "check"]));
    });

    it("tracks none of the generated paths, and sync --check exits 0", async () => {
      await sb.commit("after init");
      const tracked = (await sb.git("ls-files")).stdout.split("\n").filter(Boolean);
      expect(tracked.filter((f) => GENERATED.some((g) => f === g || f.startsWith(`${g}/`)))).toStrictEqual([]);
      // AGENTS.md holds the user's text below its region and .mcp.json is the user's: both are tracked.
      expect(tracked).toStrictEqual(expect.arrayContaining(["AGENTS.md", ".mcp.json"]));
      expect((await sb.git("status", "--porcelain")).stdout).toBe("");
      const ignored = await ignoredFiles(sb);
      for (const rel of GENERATED) {
        expect(
          ignored.some((f) => f === rel || f.startsWith(`${rel}/`)),
          rel,
        ).toBe(true);
      }
      const check = await sb.run("bun", ["repo", "sync", "--check"]);
      expectClean(sb, check);
      expect(check.stdout).toContain("up to date");
    });

    it.skipIf(process.platform === "win32")(
      "with node off PATH, fmt --check passes on the fresh consumer, and lint, turn and check fail a planted non-null assertion and floating promise until it is gone",
      async () => {
        const env = { PATH: nodelessPath(sb.root, readEnv().PATH ?? "") };
        expect((await sb.run("sh", ["-c", "command -v node"], { env })).status).not.toBe(0);
        const fmt = await sb.run("bun", ["repo", "fmt", "--check"], { env });
        expect(fmt.status, tail(fmt.out)).toBe(0);
        expect(fmt.stdout).toContain("All matched files use the correct format");
        sb.write("src/planted.ts", `${NON_NULL}\n${FLOATING}`);
        try {
          const lint = await sb.run("bun", ["repo", "lint"], { env });
          expect(lint.status, tail(lint.out)).toBe(1);
          expect(lint.out).toContain("no-non-null-assertion");
          expect(lint.out).toContain("no-floating-promises");
          await expectPlantedFails(sb, env);
        } finally {
          fs.rmSync(path.join(sb.repo, "src/planted.ts"));
        }
        await expectGatesPass(sb, env);
      },
    );

    it("lint loads the repo plugin from the install: a module let and a bare import fail until they are gone", async () => {
      sb.write("src/stateful.ts", "let count = 0;\nexport const next = (): number => ++count;\n");
      sb.write("src/polyfill.ts", 'import "./stateful.ts";\n');
      try {
        const lint = await sb.run("bun", ["repo", "lint"]);
        expect(lint.status, tail(lint.out)).toBe(1);
        expect(lint.out).toContain("repo(no-module-state)");
        expect(lint.out).toContain("repo(no-side-effect-import)");
      } finally {
        for (const rel of ["src/stateful.ts", "src/polyfill.ts"]) fs.rmSync(path.join(sb.repo, rel));
      }
      expectClean(sb, await sb.run("bun", ["repo", "lint"]));
    });

    it("check prints a live lint.skip and fails a stale one, and a skip of an unknown rule fails sync", async () => {
      const original = sb.read("workerstack.config.ts");
      sb.write("src/skipped.ts", NON_NULL);
      try {
        await expectSkipsChecked(sb, original);
      } finally {
        fs.rmSync(path.join(sb.repo, "src/skipped.ts"));
        sb.write("workerstack.config.ts", original);
        await sb.run("bun", ["repo", "sync"]);
      }
      expect(sb.read(".oxlintrc.json")).not.toContain("src/skipped.ts");
      expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
    });

    it("points core.hooksPath at tracked, executable hooks, so git commit runs turn and the message check", async () => {
      expect((await sb.git("config", "core.hooksPath")).stdout).toBe(".githooks\n");
      expect((await sb.git("ls-files", "-s", ".githooks")).stdout).toMatch(
        /^100755 \w+ 0\t\.githooks\/commit-msg\n100755 \w+ 0\t\.githooks\/pre-commit\n100755 \w+ 0\t\.githooks\/pre-push\n$/,
      );
      const commit = (message: string) => sb.run("git", ["commit", "-q", "-m", message]);
      sb.write("src/planted.ts", NON_NULL);
      await sb.git("add", "src/planted.ts");
      const planted = await commit("chore: plant");
      expect(planted.status, tail(planted.out)).toBe(1);
      expect(planted.stderr).toContain(
        "repo turn: src/planted.ts has 1 typescript(no-non-null-assertion), the baseline allows 0; fix the new one",
      );
      await sb.git("rm", "-q", "--cached", "src/planted.ts");
      fs.rmSync(path.join(sb.repo, "src/planted.ts"));
      sb.write("src/feature.ts", "export const feature = 1;\n");
      sb.write("src/index.ts", `${sb.read("src/index.ts")}export { feature } from "./feature.ts";\n`);
      await sb.git("add", "src/feature.ts", "src/index.ts");
      const untested = await commit("feat: add the feature");
      expect(untested.status, tail(untested.out)).toBe(1);
      expect(untested.stderr).toContain(
        "commit-msg: the message was refused\n  - a feat commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)\n",
      );
      const clean = await commit("chore: add the feature");
      expect(clean.status, tail(clean.out)).toBe(0);
      expect((await sb.git("log", "-1", "--format=%s")).stdout).toBe("chore: add the feature\n");
    });

    it("writes the gitignore and gitattributes blocks and the editor read-only globs from the planned outputs", () => {
      const block = (text: string) =>
        /^# repo:(ignore|generated) [\da-f]{8}\n([\s\S]*?)^# \/repo:\1$/m.exec(text)?.[2]?.split("\n").filter(Boolean);
      expect(block(sb.read(".gitignore"))).toStrictEqual([
        ".tmp/",
        ".worktrees/",
        ".repo/tmp/",
        "coverage/",
        "node_modules/",
        "knip.json",
        "knip.unignored-*.json",
        ".oxfmtrc.jsonc",
        ".oxlintrc.json",
        ".oxlintrc.unskipped-*.json",
        ".agents/",
        ".claude/",
        ".codex/",
        ".cursor/",
        ".grok/",
      ]);
      const attributes = block(sb.read(".gitattributes")) ?? [];
      expect(attributes[0]).toBe("* text=auto eol=lf");
      expect(attributes).toContain("bunfig.toml linguist-generated");
      expect(attributes).toContain(".vscode/tasks.json linguist-generated");
      // The untracked trees are ignored, not marked generated; the block files are never marked.
      expect(
        attributes.filter((line) =>
          /^(?:AGENTS\.md|\.mcp\.json|\.claude|\.codex|\.agents|\.grok|\.cursor|\.gitignore|\.gitattributes)/.test(
            line,
          ),
        ),
      ).toStrictEqual([]);
      const readonly = parse(sb.read(".vscode/settings.json"))["files.readonlyInclude"] as Record<string, boolean>;
      expect(readonly).toMatchObject({ ".claude/settings.json": true, "bunfig.toml": true });
      for (const yours of [".gitignore", "AGENTS.md", ".mcp.json"]) expect(Object.keys(readonly)).not.toContain(yours);
    });

    it("every agent-host hook runs without crashing", async () => {
      const calls = hookCalls(sb);
      expect(calls.length).toBeGreaterThan(5);
      for (const call of calls) {
        for (const payload of hookPayloads(sb, call)) {
          const r = await sb.run("bash", ["-c", call.command], {
            env: {
              CLAUDE_PROJECT_DIR: sb.repo,
              ...(call.file.startsWith(".grok") ? { GROK_WORKSPACE_ROOT: sb.repo } : {}),
            },
            input: JSON.stringify(payload),
          });
          const label = `${call.file} ${call.event} ${(payload as { tool_name?: string }).tool_name ?? ""}: ${call.command}\n${tail(r.out)}`;
          expect(r.out, label).not.toMatch(BROKEN_RUNTIME);
          expect([0, 2], label).toContain(r.status);
        }
      }
    });

    it("runs scripts and hooks through the installed repo bin", async () => {
      const job = await sb.run("bash", ["-c", "cd src && bun repo job --job exec --query 'echo hi'"]);
      expectClean(sb, job);
      expect(job.stdout).toContain("hi");

      const env = { CLAUDE_PROJECT_DIR: sb.repo, GROK_WORKSPACE_ROOT: undefined };
      const payload = {
        cwd: sb.repo,
        hook_event_name: "PreToolUse",
        session_id: "e2e",
        tool_input: { command: "cat src/index.ts" },
        tool_name: "Bash",
      };
      const rewrite = await sb.run("bash", ["-c", claudeGate(sb).command], { env, input: JSON.stringify(payload) });
      expectClean(sb, rewrite);
      const out = JSON.parse(rewrite.stdout) as { hookSpecificOutput?: { updatedInput?: { command?: string } } };
      expect(out.hookSpecificOutput?.updatedInput?.command).toMatch(
        new RegExp(`^${installedBin(sb.repo).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")} job --job exec --query `),
      );

      const map = await sb.run("bash", ["-c", '"$CLAUDE_PROJECT_DIR/node_modules/.bin/repo" hook session-map'], {
        env,
        input: JSON.stringify({ cwd: sb.repo, hook_event_name: "SessionStart", session_id: "e2e", source: "startup" }),
      });
      expectClean(sb, map);
      expect(map.stdout).toContain("run `bun repo map <dir>`");
      expect(map.stdout).toContain("src/");
    });

    it("the generated gate allows a stock reference and denies a dependency, each within 5s", async () => {
      const stock = path.join("node_modules", PACKAGE_NAME, "references");
      expect(sb.exists(path.join(stock, "plan-format.md"))).toBe(true);

      const index = sb.read("references/INDEX.md");
      const section = /<!-- repo:stack [\da-f]{8} -->\n([\s\S]*?)<!-- \/repo:stack -->/.exec(index)?.[1] ?? "";
      const targets = [...section.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? "");
      expect(targets, section).toContain(`../node_modules/${PACKAGE_NAME}/references/INDEX.md`);
      for (const target of targets) expect(sb.exists(path.join("references", target)), target).toBe(true);

      const gate = claudeGate(sb);
      const env = { CLAUDE_PROJECT_DIR: sb.repo, GROK_WORKSPACE_ROOT: undefined };
      const read = async (rel: string) => {
        const payload = {
          cwd: sb.repo,
          hook_event_name: "PreToolUse",
          session_id: "e2e",
          tool_input: { file_path: path.join(sb.repo, rel) },
          tool_name: "Read",
        };
        const started = Date.now();
        const r = await sb.run("bash", ["-c", gate.command], { env, input: JSON.stringify(payload) });
        const ms = Date.now() - started;
        process.stdout.write(`gate latency ${ms}ms for Read ${rel}\n`);
        expect(ms, `${rel} took ${ms}ms`).toBeLessThan(5000);
        expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
        const decision = (JSON.parse(r.stdout || "{}") as { hookSpecificOutput?: { permissionDecision?: string } })
          .hookSpecificOutput?.permissionDecision;
        return { decision, out: r.out, status: r.status };
      };
      const allowed = await read(path.join(stock, "plan-format.md"));
      expect(allowed.decision, allowed.out).not.toBe("deny");
      expect(allowed.status, allowed.out).toBe(0);
      const denied = await read(path.join("node_modules", "rulesync", "package.json"));
      expect(denied.decision, denied.out).toBe("deny");
    });

    it("deleting every ignored generated file and running bun install reproduces each byte for byte", async () => {
      const before = await generatedHashes(sb);
      expect(before.length).toBeGreaterThan(50);
      expect(
        before.some((l) => l.includes(" -> ")),
        "links",
      ).toBe(true);
      for (const rel of await ignoredFiles(sb)) removeGenerated(path.join(sb.repo, rel));
      expect((await generatedHashes(sb)).length).toBe(0);
      expectClean(sb, await sb.run("bun", ["install"]));
      expect(await generatedHashes(sb)).toStrictEqual(before);
      expect((await sb.git("status", "--porcelain")).stdout).toBe("");
    });

    it("sync works with the registry unreachable", async () => {
      const before = await generatedHashes(sb);
      fs.rmSync(path.join(sb.repo, ".claude", "settings.json"));
      fs.rmSync(path.join(sb.repo, "AGENTS.md"));
      expect(registryUrl).not.toContain("127.0.0.1:9/");
      const offline = {
        BUN_CONFIG_REGISTRY: "http://127.0.0.1:9/",
        HTTPS_PROXY: "http://127.0.0.1:9",
        HTTP_PROXY: "http://127.0.0.1:9",
      };
      expectClean(sb, await sb.run("bun", ["repo", "sync"], { env: offline }));
      expect(await generatedHashes(sb)).toStrictEqual(before);
    });

    it("an unknown config key fails sync, while install prints it, exits 0 and changes no file", async () => {
      const original = sb.read("workerstack.config.ts");
      sb.write("workerstack.config.ts", original.replace("agents:", "bogusKey: true,\n  agents:"));
      try {
        const keep = () => true;
        const before = hashes(sb.repo, keep);
        const sync = await sb.run("bun", ["repo", "sync"]);
        expect(sync.status, tail(sync.out)).toBe(1);
        expect(sync.stderr).toContain('unknown key "bogusKey"');
        const install = await sb.run("bun", ["install"]);
        expect(install.status, tail(install.out)).toBe(0);
        expect(install.out).toContain('unknown key "bogusKey"');
        expect(hashes(sb.repo, keep)).toStrictEqual(before);
      } finally {
        sb.write("workerstack.config.ts", original);
      }
      expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
    });

    it("limiting agents.hosts prunes the other trees, and restoring them brings the trees back", async () => {
      const before = await generatedHashes(sb);
      const original = sb.read("workerstack.config.ts");
      try {
        setHosts(sb, ["claude"]);
        expectClean(sb, await sb.run("bun", ["repo", "sync"]));
        for (const rel of [".codex", ".agents", ".grok", ".cursor"]) expect(sb.exists(rel), rel).toBe(false);
        for (const rel of ["AGENTS.md", ".mcp.json", ".claude/settings.json"]) expect(sb.exists(rel), rel).toBe(true);
        expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
      } finally {
        sb.write("workerstack.config.ts", original);
        await sb.run("bun", ["repo", "sync"]);
      }
      expect(await generatedHashes(sb)).toStrictEqual(before);
    });

    it("installed CLI subcommands work", async () => {
      expect(await installedVersion(sb)).toBe(version);
      expect(sb.expectOk(await sb.cli("help")).stdout).toContain("Usage: repo");
      expect(sb.expectOk(await sb.cli("map")).stdout).toContain("src/");
      for (const cmd of ["check", "sync", "yolo", "purge-mcps"]) expectClean(sb, await sb.cli(cmd));

      for (const cmd of ["generate", "upgrade"]) {
        const r = await sb.cli(cmd);
        expect(r.status, cmd).not.toBe(0);
        expect(r.stderr).toContain(`unknown command "${cmd}"`);
      }
    });

    it("ships tsconfig bases with ts-reset, a vitest preset, and a check that keeps them", async () => {
      const pkgBefore = sb.read("package.json");
      const lockBefore = sb.read("bun.lock");
      const wrote = ["tsconfig.json", "tsconfig.src.json", "src/main.ts", "vitest.config.ts", "src/a.test.ts"];
      const tsconfig = { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] };
      const srcTsconfig = {
        exclude: ["node_modules", "**/*.test.ts"],
        extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
      };
      try {
        sb.write("tsconfig.json", `${JSON.stringify(tsconfig)}\n`);
        sb.write("tsconfig.src.json", `${JSON.stringify(srcTsconfig)}\n`);
        // Pure-marked, so repo(no-module-side-effects) passes and only the type error is left.
        sb.write("src/main.ts", 'export const main: number = /* @__PURE__ */ JSON.parse("1")\n');
        const tsc = await sb.run("bun", [path.join(sb.repo, "node_modules", "typescript", "bin", "tsc"), "-p", "."]);
        expect(tsc.status, tail(tsc.out)).toBe(2);
        expect(tsc.stdout).toContain(
          "src/main.ts(1,14): error TS2322: Type 'unknown' is not assignable to type 'number'.",
        );
        expect(tsc.stdout).not.toContain("TS2688");

        sb.write("tsconfig.json", `${JSON.stringify({ ...tsconfig, files: [] })}\n`);
        const check = await sb.cli("check");
        expect(check.out, tail(check.out)).not.toMatch(BROKEN_RUNTIME);
        expect(check.status, tail(check.out)).toBe(1);
        expect(check.stderr).toContain(
          'tsconfig: tsconfig.json sets "files", which replaces the base\'s reset.d.ts. List sources under "include".',
        );
        sb.write("tsconfig.json", `${JSON.stringify(tsconfig)}\n`);
        expectClean(sb, await sb.cli("check"));

        expectClean(sb, await sb.run("bun", ["add", "-d", "vitest@^3.2.7"]));
        sb.write(
          "vitest.config.ts",
          'import { defineProject } from "@workerstack/repo/vitest"\nexport default defineProject({ test: { include: ["src/**/*.test.ts"] } })\n',
        );
        sb.write(
          "src/a.test.ts",
          'import { expect, it } from "vitest"\nimport { answer } from "./index"\nit("answers", () => expect(answer).toBe(42))\n',
        );
        const vitest = await sb.run("bunx", ["vitest", "run"], { env: { NO_COLOR: "1" } });
        expectClean(sb, vitest);
        expect(vitest.stdout).toMatch(/Tests\s+1 passed \(1\)/);
      } finally {
        // Leave the tree as init left it, so re-init below still finds nothing to change.
        for (const rel of wrote) fs.rmSync(path.join(sb.repo, rel), { force: true });
        sb.write("package.json", pkgBefore);
        sb.write("bun.lock", lockBefore);
      }
    });

    it("re-init is idempotent", async () => {
      await sb.commit("first init");
      expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
      expect((await sb.git("status", "--porcelain")).stdout).toBe("");
    });
  });
});
