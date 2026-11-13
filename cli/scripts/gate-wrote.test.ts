import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { camelCall } from "./__fixtures__/hook-payload.ts";
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

  function call(file: string) {
    return processFatTools(
      camelCall("Write", { content: "x", file_path: file }, { cwd: a, sessionId: "sid9", workspaceRoot: ws }),
    );
  }

  expect(call(path.join(a, ".repo/plans/x.md"))).toBeNull();
  expect(call(path.join(a, ".repo/scratch/scratch/x.txt"))).toStrictEqual({
    type: "rewrite",
    updatedInput: { content: "x", file_path: path.join(ws, ".repo/scratch/scratch/x.txt") },
  });
  const wrote = fs.readFileSync(path.join(ws, ".repo/tmp/sessions/sid9/wrote.txt"), "utf8").trim().split("\n");
  expect(wrote).toStrictEqual(
    [".repo/plans/x.md", ".repo/scratch/scratch/x.txt"].map((p) => path.join(ws, p).replaceAll("\\", "/")),
  );
  expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  expect(fs.existsSync(path.join(ws, ".repo/scratch/scratch"))).toBe(false);
});
