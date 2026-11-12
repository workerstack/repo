import fs from "node:fs";

import { expect, it, vi } from "vitest";

import { doctorCli, tmp, writeBin } from "./__fixtures__/doctor-kit.ts";
import {
  ALL_OFFERED,
  checkout,
  codexHome,
  fakeGrok,
  LISTS,
  md,
  realRow,
  rowOf,
  toml,
} from "./__fixtures__/doctor-models-kit.ts";

it("agent models is ok when every agent model is offered, and never checks Claude agents", async () => {
  const r = await rowOf({ ...ALL_OFFERED, ".claude/agents/scout.md": md("haiku") });
  expect(r.text).toMatch(/^agent models\s+ok\s*$/);
  expect(r.lines).toHaveLength(1);
});

// The default runner spawns the real CLI: PATH holds only a fake grok, so no machine's own grok or cursor-agent
// answers.
it("with the real list runner, reads the ids the CLI prints", async () => {
  vi.stubEnv("PATH", fakeGrok(["grok-4.7"]));
  expect(await realRow({ ".grok/agents/scout.md": md("grok-4.7") })).toMatch(/^agent models\s+ok\s*$/);
  expect(await realRow({ ".grok/agents/scout.md": md("grok-9") })).toMatch(
    /to fix[\s\S]*model grok-9 is not offered by grok; offered: grok-4\.7/,
  );
});

it("with the real list runner, skips a CLI that is not on PATH", async () => {
  vi.stubEnv("PATH", tmp("doc-no-grok-"));
  expect(await realRow({ ".grok/agents/scout.md": md("grok-4.7") })).toMatch(/skipped: .*grok/);
});

it("agent models is ok and runs no list command when the checkout has no agent files", async () => {
  const r = await rowOf({ ".claude/agents/scout.md": md("haiku") });
  expect(r.text).toMatch(/^agent models\s+ok\s*$/);
  expect(r.calls).toStrictEqual([]);
});

it("agent models asks only the CLIs that have an agent file to check", async () => {
  const r = await rowOf({ ".grok/agents/scout.md": md("grok-4.7") });
  expect(r.calls).toStrictEqual(["grok models"]);
});

it("flags a codex, a grok, an agy and a cursor agent naming a dropped model, with the offered ids", async () => {
  const r = await rowOf({
    ".agents/agents/scout.md": md("gemini-3.8-flash-low"),
    ".codex/agents/scout.toml": toml("gpt-5.4-mini"),
    ".cursor/agents/scout.md": md("claude-sonnet-5-thinking-high"),
    ".grok/agents/scout.md": md("grok-4.5"),
  });

  expect(r.lines[0]).toMatch(/^agent models\s+4 to fix\s*$/);
  expect(r.lines.slice(1)).toStrictEqual([
    "- .codex/agents/scout.toml: model gpt-5.4-mini is not offered by codex; " +
      "offered: gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna, gpt-reserve",
    "- .grok/agents/scout.md: model grok-4.5 is not offered by grok; offered: grok-4.7",
    "- .agents/agents/scout.md: model gemini-3.8-flash-low is not offered by agy; " +
      "offered: inherit, flash, pro, flash_lite",
    "- .cursor/agents/scout.md: model claude-sonnet-5-thinking-high is not offered by cursor; " +
      "offered: auto, claude-sonnet-5-5-medium",
  ]);
});

it("checks agy agents against the fixed set without running any command", async () => {
  const r = await rowOf({
    ".agents/agents/a.md": md("inherit"),
    ".agents/agents/b.md": md("flash"),
    ".agents/agents/c.md": md("pro"),
    ".agents/agents/d.md": md("flash_lite"),
  });

  expect(r.text).toMatch(/^agent models\s+ok\s*$/);
  expect(r.lines).toHaveLength(1);
  expect(r.calls).toStrictEqual([]);
});

it("lists only the first 6 offered ids", async () => {
  const many = Array.from({ length: 9 }, (_, i) => `m${i + 1}`);
  const r = await rowOf({ ".codex/agents/scout.toml": toml("gone") }, { home: codexHome(many) });
  expect(r.lines[1]).toBe(
    "- .codex/agents/scout.toml: model gone is not offered by codex; offered: m1, m2, m3, m4, m5, m6",
  );
});

it("flags grok-4.5 in the grok role file and in the global settings [subagents.models]", async () => {
  const r = await rowOf({
    ".grok/roles/scout.toml": toml("grok-4.5"),
    "agents/global-settings/grok.toml":
      '[ui]\nmodel = "not-a-subagent"\n\n[subagents.toggle]\nexplore = true\n\n' +
      '[subagents.models]\nexplore = "grok-4.5"\nscout = "grok-4.7"\n\n[memory]\nenabled = false\n',
  });

  expect(r.lines[0]).toMatch(/^agent models\s+2 to fix\s*$/);
  expect(r.lines.slice(1)).toStrictEqual([
    "- .grok/roles/scout.toml: model grok-4.5 is not offered by grok; offered: grok-4.7",
    "- agents/global-settings/grok.toml: model grok-4.5 is not offered by grok; offered: grok-4.7",
  ]);
});

it("leaves a cursor agent on `model: inherit` unchecked, since it runs the parent's model", async () => {
  const r = await rowOf({ ...ALL_OFFERED, ".cursor/agents/scout.md": md("inherit") });
  expect(r.text).toMatch(/^agent models\s+ok\s*$/);
  expect(r.calls.some((c) => c.startsWith("cursor-agent"))).toBe(false);
});

it("is report only: the doctor run prints the row before the schema line and keeps its exit code", () => {
  if (process.platform === "win32") return;
  const cwd = checkout({ ".grok/agents/scout.md": md("grok-4.5") });
  const bin = tmp("doc-models-bin-");
  writeBin(bin, "grok", `#!/bin/sh\nprintf '%s' '${LISTS.grok}'\n`);
  const r = doctorCli(cwd, { HOME: fs.realpathSync(tmp("doc-models-h-")), PATH: bin });
  const lines = r.stdout.split("\n");
  const at = lines.findIndex((l) => /^agent models\s+1 to fix/.test(l));
  expect(at, r.stdout).toBeGreaterThan(-1);
  expect(lines[at + 1]).toBe("- .grok/agents/scout.md: model grok-4.5 is not offered by grok; offered: grok-4.7");
  expect(r.status).toBe(1);
});
