import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./fixtures/gate-workspace.ts";
import { camelCall } from "./fixtures/hook-payload.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { REASON_REREAD } from "./gate.constants.ts";

const tmp = useTmp();

it("denies full Read of a path this session wrote; allows offset", () => {
  const ws = tmp.dir("gate-reread-");
  const file = path.join(ws, "src", "a.ts");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "export {}\n");
  const session = { sessionId: "sid1", workspaceRoot: ws };
  processFatTools(camelCall("Write", { content: "export {}\n", file_path: file }, session));
  const whole = processFatTools(camelCall("Read", { file_path: file }, session));
  expect(whole).toStrictEqual({ reason: REASON_REREAD, type: "deny" });
  const sliced = processFatTools(camelCall("Read", { file_path: file, limit: 20, offset: 1 }, session));
  expect(sliced?.type).not.toBe("deny");
});

it("leaves a nested plan to orchestrate-parent, records it, and writes no target", () => {
  const ws = tmp.dir("gate-nested-");
  const a = path.join(ws, "packages/a");
  const call = (file: string) =>
    processFatTools(
      camelCall("Write", { content: "x", file_path: file }, { cwd: a, sessionId: "sid9", workspaceRoot: ws }),
    );
  expect(call(path.join(a, ".tmp/repo/plans/x.md"))).toBeNull();
  expect(call(path.join(a, ".tmp/repo/scratch/x.txt"))).toStrictEqual({
    type: "rewrite",
    updatedInput: { content: "x", file_path: path.join(ws, ".tmp/repo/scratch/x.txt") },
  });
  const wrote = fs.readFileSync(path.join(ws, ".tmp/repo/sessions/sid9/wrote.txt"), "utf8").trim().split("\n");
  expect(wrote).toStrictEqual(
    [".tmp/repo/plans/x.md", ".tmp/repo/scratch/x.txt"].map((p) => path.join(ws, p).replaceAll("\\", "/")),
  );
  expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  expect(fs.existsSync(path.join(ws, ".tmp/repo/scratch"))).toBe(false);
});
