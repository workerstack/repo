import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTORUN_NEEDLES, BEHIND, OWNED_HOOKS, applyUnion, checkUnion } from "./hooks-union.ts";
import { hookCommand } from "./hook-command.ts";

const tmpDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function plant(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "union-edge-"));
  tmpDirs.push(dir);
  return dir;
}

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

const ownedGroups = () =>
  OWNED_HOOKS.map((n) => ({ matcher: "x", hooks: [{ type: "command", command: hookCommand(n) }] }));

describe("roots", () => {
  it("applies and checks the process cwd when no options are given", () => {
    const ws = plant();
    vi.spyOn(process, "cwd").mockReturnValue(ws);
    expect(applyUnion()).toEqual({ ok: true, check: false });
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
    for (const f of [".claude/settings.json", ".codex/hooks.json", ".agents/hooks.json", ".cursor/hooks.json"]) {
      put(ws, f, { hooks: { PreToolUse: ownedGroups() } });
    }
    expect(applyUnion({ workspaceRoot: ws, check: true })).toEqual({ ok: true, check: true, failures: [] });
  });

  it("reports drift as a failed check", () => {
    const ws = plant();
    const r = applyUnion({ workspaceRoot: ws, check: true });
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
      { hooks: [1, {}, { type: "command", command: "echo nested" }] },
      { matcher: "m", hooks: [{ type: "command", command: "bun scripts/mine.ts" }] },
    ];
    put(ws, ".claude/settings.json", { hooks: { PreToolUse: odd }, permissions: { deny: ["Read(x)", 5, "Write(y)"] } });
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const pre = listAt(ws, ".claude/settings.json", "hooks", "PreToolUse");
    expect(pre[0]).toEqual({ matcher: "Write|Edit", hooks: [{ type: "command", command: BEHIND }] });
    expect(pre.slice(1)).toEqual(odd);
    expect(listAt(ws, ".claude/settings.json", "permissions", "deny")).toEqual(["Read(x)", 5]);
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
    expect(get(ws, ".cursor/hooks.json")).toMatchObject({ version: 1, hooks: { preToolUse: [] } });
    expect(get(ws, ".agents/hooks.json")).toMatchObject({ rulesync: { PreToolUse: [] } });
  });
});

describe("flat session lists", () => {
  it("flattens grouped session entries and keeps odd ones", () => {
    const ws = plant();
    consumerScripts(ws);
    const keep = { type: "command", command: "echo keep" };
    const sessions = [{ hooks: [keep] }, "text", { command: "echo flat" }];
    put(ws, ".cursor/hooks.json", { hooks: { sessionStart: sessions } });
    put(ws, ".agents/hooks.json", { rulesync: { SessionStart: sessions } });
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const cursor = listAt(ws, ".cursor/hooks.json", "hooks", "sessionStart");
    expect(cursor.slice(0, 3)).toEqual([keep, "text", { command: "echo flat" }]);
    expect(cursor).toHaveLength(6);
    const agents = listAt(ws, ".agents/hooks.json", "rulesync", "SessionStart");
    expect(agents.slice(0, 3)).toEqual(cursor.slice(0, 3));
  });
});
