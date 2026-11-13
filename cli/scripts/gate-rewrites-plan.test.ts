import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { camelCall } from "./__fixtures__/hook-payload.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import type { HookInput } from "./hook-input.ts";

const tmp = useTmp();

function put(file: string, extra: HookInput) {
  return processFatTools(camelCall("Write", { content: "ok", file_path: file }, extra));
}

/** The gate's answers to plain writes of README.md and of an unlisted src file in `ws`. */
function plainWrites(ws: string) {
  return [path.join(ws, "README.md"), path.join(ws, "src/other.ts")].map((f) => put(f, { workspaceRoot: ws }));
}

function writePlan(ws: string, status: string, listed: string) {
  const plans = path.join(ws, ".repo", "plans");
  fs.mkdirSync(plans, { recursive: true });
  const planPath = path.join(plans, "1-listed-20260827T173530Z.md");
  const front = `---\nserial: 1\nname: listed\nstatus: ${status}\ncreated: 2026-08-27T17:35:30Z\nsource: "test"\n---\n`;
  fs.writeFileSync(planPath, `${front}\n# listed\n\nListed src: \`${listed}\`\nhttps://example.com/README.md\n`);

  return planPath;
}

it("plan allow-list: allows listed src and plan path; denies README/docs/examples; allows unlisted src", () => {
  const ws = tmp.dir("gate-impl-write-");
  const listed = path.join(ws, "src", "listed.ts");
  const planPath = writePlan(ws, "in-progress", listed);
  const scout = { subagentType: "scout", workspaceRoot: ws };
  expect(put(listed, scout)).toBeNull();
  const edit = { file_path: planPath, new_string: "b", old_string: "a" };
  expect(processFatTools(camelCall("Edit", edit, scout))).toBeNull();
  expect(plainWrites(ws)).toStrictEqual([null, null]);
});

it("plan allow-list: prompt-listed path allowed despite in-progress plan; prompt exclusive denies unlisted", () => {
  const ws = tmp.dir("gate-impl-prompt-");
  writePlan(ws, "in-progress", path.join(ws, "src", "listed.ts"));
  const promptPath = path.join(ws, "scripts", "gate-fat-tools.ts");
  const prompt = `Fix \`${promptPath}\``;
  expect(put(promptPath, { prompt, workspaceRoot: ws })).toBeNull();
  expect(put(path.join(ws, "src/other.ts"), { prompt, workspaceRoot: ws })).toBeNull();
  const readme = path.join(ws, "README.md");
  expect(put(readme, { userPrompt: `touch \`${readme}\``, workspaceRoot: ws })).toBeNull();
});

it("plan allow-list: with no in-progress plan denies README.md and allows unlisted src", () => {
  const ws = tmp.dir("gate-impl-nop-");
  writePlan(ws, "ready", path.join(ws, "src", "listed.ts"));
  expect(plainWrites(ws)).toStrictEqual([null, null]);
});
