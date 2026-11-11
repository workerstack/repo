import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { hookCommand } from "./hook-command.ts";
import { BEHIND } from "./hooks-union-commands.ts";
import { AUTORUN_NEEDLES, OWNED_HOOKS } from "./hooks-union.constants.ts";
import { applyUnion, checkUnion } from "./hooks-union.ts";

const { tempDir: plant } = useTempDirs("union-edge-");

function put(ws: string, rel: string, body: unknown) {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof body === "string" ? body : JSON.stringify(body));
}

function get(ws: string, rel: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(ws, rel), "utf8"));
}

/** The list at `keys` below the JSON file, or [] when any step is not there. */
function listAt(ws: string, rel: string, ...keys: string[]): unknown[] {
  let cur = get(ws, rel);
  for (const k of keys) cur = typeof cur === "object" && cur !== null ? Reflect.get(cur, k) : undefined;
  return Array.isArray(cur) ? cur : [];
}

function consumerScripts(ws: string) {
  for (const n of AUTORUN_NEEDLES) put(ws, `scripts/${n}`, "");
}

function ownedGroups() {
  return OWNED_HOOKS.map((n) => ({ hooks: [{ command: hookCommand(n), type: "command" }], matcher: "x" }));
}

describe("roots", () => {
  it("applies and checks the process cwd when no options are given", () => {
    const ws = plant();
    vi.spyOn(process, "cwd").mockReturnValue(ws);
    expect(applyUnion()).toStrictEqual({ check: false, ok: true });
    expect(fs.existsSync(path.join(ws, ".claude/settings.json"))).toBe(true);
    expect(checkUnion()).toContain("claude: missing scrub-spawn-prompt");
  });

  it("takes a bare path as workspace, source and consumer root", () => {
    const ws = plant();
    expect(applyUnion(ws).ok).toBe(true);
    expect(checkUnion(ws)).toContain("cursor: missing gate-fat-tools");
  });

  it("answers a check that finds the union in place", () => {
    const ws = plant();
    for (const f of [".claude/settings.json", ".codex/hooks.json", ".agents/hooks.json", ".cursor/hooks.json"])
      put(ws, f, { hooks: { PreToolUse: ownedGroups() } });

    expect(applyUnion({ check: true, workspaceRoot: ws })).toStrictEqual({ check: true, failures: [], ok: true });
  });

  it("reports drift as a failed check", () => {
    const ws = plant();
    const r = applyUnion({ check: true, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^drift: claude: missing \.claude\/settings\.json/);
  });
});

describe("odd files", () => {
  it("treats a blank file and a non-object JSON file as empty", () => {
    const ws = plant();
    put(ws, ".claude/settings.json", "  \n");
    put(ws, ".codex/hooks.json", "[]");
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    expect(get(ws, ".claude/settings.json")).toMatchObject({ hooks: { PreToolUse: [] }, permissions: { deny: [] } });
    expect(get(ws, ".codex/hooks.json")).toMatchObject({ PreToolUse: [] });
  });

  it("keeps odd groups and entries and adds the consumer hooks once", () => {
    const ws = plant();
    consumerScripts(ws);
    const odd = [
      "text",
      null,
      {},
      { command: "echo flat" },
      { hooks: [1, {}, { command: "echo nested", type: "command" }] },
      { hooks: [{ command: "bun scripts/mine.ts", type: "command" }], matcher: "m" },
    ];
    put(ws, ".claude/settings.json", { hooks: { PreToolUse: odd }, permissions: { deny: ["Read(x)", 5, "Write(y)"] } });
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const pre = listAt(ws, ".claude/settings.json", "hooks", "PreToolUse");
    expect(pre[0]).toStrictEqual({ hooks: [{ command: BEHIND, type: "command" }], matcher: "Write|Edit" });
    expect(pre.slice(1)).toStrictEqual(odd);
    expect(listAt(ws, ".claude/settings.json", "permissions", "deny")).toStrictEqual(["Read(x)", 5]);
  });
});

describe("odd tables", () => {
  it("replaces a non-object hooks table and a non-object permissions table", () => {
    const ws = plant();
    put(ws, ".claude/settings.json", { hooks: [], permissions: [] });
    put(ws, ".codex/hooks.json", { hooks: [] });
    put(ws, ".cursor/hooks.json", { hooks: "none" });
    put(ws, ".agents/hooks.json", { rulesync: [] });
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    expect(get(ws, ".claude/settings.json")).toMatchObject({ hooks: { PreToolUse: [] }, permissions: { deny: [] } });
    expect(get(ws, ".cursor/hooks.json")).toMatchObject({ hooks: { preToolUse: [] }, version: 1 });
    expect(get(ws, ".agents/hooks.json")).toMatchObject({ rulesync: { PreToolUse: [] } });
  });
});

describe("flat session lists", () => {
  it("flattens grouped session entries and keeps odd ones", () => {
    const ws = plant();
    consumerScripts(ws);
    const keep = { command: "echo keep", type: "command" };
    const sessions = [{ hooks: [keep] }, "text", { command: "echo flat" }];
    put(ws, ".cursor/hooks.json", { hooks: { sessionStart: sessions } });
    put(ws, ".agents/hooks.json", { rulesync: { SessionStart: sessions } });
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const cursor = listAt(ws, ".cursor/hooks.json", "hooks", "sessionStart");
    expect(cursor.slice(0, 3)).toStrictEqual([keep, "text", { command: "echo flat" }]);
    expect(cursor).toHaveLength(6);
    const agents = listAt(ws, ".agents/hooks.json", "rulesync", "SessionStart");
    expect(agents.slice(0, 3)).toStrictEqual(cursor.slice(0, 3));
  });
});
