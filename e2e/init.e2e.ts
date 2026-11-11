/**
 * The published package, end to end: launch it the way users do (bunx) from a real
 * registry into real consumer repos, then use what it installed. Init copies nothing:
 * `bun install` runs `repo sync` (postinstall), which generates the gitignored agent trees.
 */
import { beforeAll, describe, expect, inject, it } from "vitest";

import type { GetSandbox } from "./get-sandbox.types";
import { blocksCase, gateLatencyCase, installedBinCase } from "./init-files-cases";
import { installCases, manifestCase, untrackedCase } from "./init-fresh-cases";
import { gitHooksCase, nodelessGatesCase, pluginAndSkipCases } from "./init-gate-cases";
import { expectClean, hookCalls, hookPayloads, installedVersion } from "./init-helpers";
import { hostsCase, regenerateCases, reinitCase, unknownKeyCase } from "./init-sync-cases";
import { presetsCase } from "./presets-case";
import { PACKAGE_NAME } from "./registry";
import { Sandbox } from "./sandbox";
import { BROKEN_RUNTIME } from "./sandbox.constants";
import { tail } from "./tail";

/** Every agent-host hook runs, one call after another in the shared sandbox, without crashing. */
function hookCallsCase(get: GetSandbox) {
  it("every agent-host hook runs without crashing", async () => {
    const sb = get();
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
        const tool = (payload /* every payload object may carry a tool name */ as { tool_name?: string }).tool_name;
        const label = `${call.file} ${call.event} ${tool ?? ""}: ${call.command}\n${tail(r.out)}`;
        expect(r.out, label).not.toMatch(BROKEN_RUNTIME);
        expect([0, 2], label).toContain(r.status);
      }
    }
  });
}

/** The installed CLI runs its subcommands, one after another, and refuses the removed ones. */
function cliCase(get: GetSandbox) {
  it("installed CLI subcommands work", async () => {
    const sb = get();
    expect(await installedVersion(sb)).toBe(inject("version"));
    expect(sb.expectOk(await sb.cli("help")).stdout).toContain("Usage: repo");
    expect(sb.expectOk(await sb.cli("map")).stdout).toContain("src/");
    for (const cmd of ["check", "sync", "yolo", "purge-mcps"]) expectClean(sb, await sb.cli(cmd));

    for (const cmd of ["generate", "upgrade"]) {
      const r = await sb.cli(cmd);
      expect(r.status, cmd).not.toBe(0);
      expect(r.stderr).toContain(`unknown command "${cmd}"`);
    }
  });
}

/** The fresh repo's cases, in the order they run against its one sandbox. */
function freshRepoCases(get: GetSandbox) {
  installCases(get);
  manifestCase(get);
  untrackedCase(get);
  nodelessGatesCase(get);
  pluginAndSkipCases(get);
  gitHooksCase(get);
  blocksCase(get);
  hookCallsCase(get);
  installedBinCase(get);
  gateLatencyCase(get);
  regenerateCases(get);
  unknownKeyCase(get);
  hostsCase(get);
  cliCase(get);
  presetsCase(get);
  reinitCase(get);
}

describe("bunx", () => {
  describe("fresh repo", () => {
    let made: Sandbox | undefined;
    function get(): Sandbox {
      if (made === undefined) throw new Error("the fresh sandbox is made in beforeAll");
      return made;
    }

    beforeAll(async () => {
      const sb = new Sandbox("fresh");
      made = sb;
      await sb.scaffold();
      expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
    });

    freshRepoCases(get);
  });
});
