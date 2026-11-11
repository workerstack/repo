import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { orchestrateKit, parseJson } from "./fixtures/orchestrate-kit.ts";
import { stampPath } from "./strategy.ts";

const kit = orchestrateKit();
const sessionFile = (ws: string, sid: string) => path.join(ws, ".tmp/repo/sessions", sid, "git-asked.json");
const words = (ws: string, sid: string) =>
  parseJson<{ words: string[] }>(fs.readFileSync(sessionFile(ws, sid), "utf8")).words;
const workspace = () => fs.realpathSync(kit.temp());

function submit(ws: string, sid: string, text: string) {
  const out = kit.run(
    { cwd: ws, hook_event_name: "UserPromptSubmit", prompt: text, session_id: sid },
    { CLAUDE_PROJECT_DIR: ws, GROK_WORKSPACE_ROOT: "" },
  );
  expect(out.status).toBe(0);
  return out;
}

it("records the words a Claude, Codex or Grok prompt names, and the next prompt clears them", () => {
  const ws = workspace();
  submit(ws, "g1", "stash the main checkout");
  expect(JSON.parse(fs.readFileSync(sessionFile(ws, "g1"), "utf8"))).toStrictEqual({ words: ["stash"] });
  submit(ws, "g1", "thanks, now carry on");
  expect(words(ws, "g1")).toStrictEqual([]);
  expect(fs.readdirSync(path.dirname(sessionFile(ws, "g1"))).filter((n) => n.endsWith(".tmp"))).toStrictEqual([]);
  // Grok spells the payload in camelCase and names the session in its env.
  const grok = kit.run(
    { hookEventName: "UserPromptSubmit", userPrompt: "git checkout main", workspaceRoot: ws },
    { GROK_HOOK_EVENT: "UserPromptSubmit", GROK_SESSION_ID: "gk", GROK_WORKSPACE_ROOT: ws },
  );
  expect(grok.status).toBe(0);
  expect(words(ws, "gk")).toStrictEqual(["checkout"]);
});

it("reads each phrase as one grant or none", () => {
  const ws = workspace();
  const cases: [string, string[]][] = [
    ["stash the main checkout", ["stash"]],
    ["git checkout main", ["checkout"]],
    ["clean up the code", []],
    ["merge to main", []],
    ["the stashed work is in the main checkout", []],
    ["rebase it and force push", ["force", "rebase"]],
  ];
  for (const [text, expected] of cases) {
    submit(ws, "g2", text);
    expect(words(ws, "g2"), text).toStrictEqual(expected);
  }
});

it("writes nothing without a session id, and still stamps the prompt gate as before", () => {
  const ws = workspace();
  const out = kit.run(
    { cwd: ws, hook_event_name: "UserPromptSubmit", prompt: "stash it" },
    { CLAUDE_PROJECT_DIR: ws, GROK_SESSION_ID: "", GROK_WORKSPACE_ROOT: "" },
  );
  expect(out.status).toBe(0);
  expect(fs.existsSync(path.join(ws, ".tmp/repo/sessions"))).toBe(false);
});

it("writes where the gate reads, however odd the session id", () => {
  const ws = workspace();
  // The gate reads git-asked.json beside strategy.json, under the sid with every non-word character removed.
  const readerFile = (sid: string) => path.join(path.dirname(stampPath(ws, sid)), "git-asked.json");
  submit(ws, "../escape", "stash it");
  expect(readerFile("../escape")).toBe(path.join(ws, ".tmp/repo/sessions/escape/git-asked.json"));
  expect(JSON.parse(fs.readFileSync(readerFile("../escape"), "utf8"))).toStrictEqual({ words: ["stash"] });
  expect(fs.existsSync(path.join(ws, ".tmp/escape"))).toBe(false);
  submit(ws, "../../agents/", "stash it");
  expect(fs.existsSync(path.join(ws, ".tmp/repo/sessions/git-asked.json"))).toBe(false);
});

it("leaves a host stop banner alone and fails open when the session dir cannot be made", () => {
  const ws = workspace();
  submit(ws, "g3", "stash it");
  submit(ws, "g3", "Stop hook feedback: keep going");
  expect(words(ws, "g3")).toStrictEqual(["stash"]);
  const blocked = workspace();
  fs.mkdirSync(path.join(blocked, ".tmp/repo"), { recursive: true });
  fs.writeFileSync(path.join(blocked, ".tmp/repo/sessions"), "a file where the dir should be");
  // The prompt still gets its usual reply; only the stamp is lost.
  expect(submit(blocked, "g4", "stash it").stdout).toContain("additionalContext");
  expect(fs.statSync(path.join(blocked, ".tmp/repo/sessions")).isFile()).toBe(true);
});
