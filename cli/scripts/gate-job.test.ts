import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./fixtures/gate-workspace.ts";
import { camelCall } from "./fixtures/hook-payload.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { isWorkspaceJobScript, jobCommand, parseJobCommand, quoteQuery } from "./gate-job.ts";
import type { HookInput } from "./hook-input.ts";

const tmp = useTmp();
const JOB = ["--job", "test", "--query", "x"].join(" ");
const ACCEPTED = [
  `bun repo job ${JOB}`,
  `rtk bun repo job ${JOB}`,
  `bun /r/node_modules/.bin/repo job ${JOB}`,
  `/r/node_modules/.bin/repo job ${JOB}`,
  `../node_modules/.bin/repo job ${JOB}`,
  `rtk /r/node_modules/.bin/repo job ${JOB}`,
  `/usr/bin/rtk /home/me/.bun/bin/bun /r/node_modules/.bin/repo job ${JOB}`,
];
const REFUSED = [
  `/other/node_modules/.bin/repo job ${JOB}`,
  `node /r/node_modules/.bin/repo job ${JOB}`,
  `/r/node_modules/.bin/repo lessons ${JOB}`,
  `/r/node_modules/.bin/repo ${JOB}`,
  `bun repo jobs ${JOB}`,
  `bun repo`,
  `repo job ${JOB}`,
  `bunx repo job ${JOB}`,
];

it("jobCommand runs the checkout's installed repo bin", () => {
  expect(jobCommand("/r", "--job exec --query true")).toBe("/r/node_modules/.bin/repo job --job exec --query true");
});

it(
  "parses bun repo job, bun <bin> job, <bin> job and rtk <bin> job, " +
    "and refuses other bins and commands (path.posix)",
  () => {
    const roots = { checkout: "/r", cwd: "/r/sub", root: "/r" };
    function ok(c: string) {
      return isWorkspaceJobScript(c, roots, path.posix);
    }
    for (const c of ACCEPTED) expect(ok(c), c).toBe(true);
    for (const c of REFUSED) expect(ok(c), c).toBe(false);
    expect(parseJobCommand(`bun repo job --job test --query x`, roots)).toStrictEqual({
      hasQuery: true,
      hasStash: false,
      job: "test",
    });
    expect(parseJobCommand(`/r/node_modules/.bin/repo job --job exec --query x`, roots)).toStrictEqual({
      hasQuery: true,
      hasStash: false,
      job: "exec",
    });
  },
);

it("lets the job command it hands out run, and still denies a denylisted path inside the job", () => {
  const ws = tmp.dir("gate-bin-deny-");
  function bash(command: string, extra: HookInput = {}) {
    return processFatTools(camelCall("Bash", { command }, { workspaceRoot: ws, ...extra }));
  }
  for (const extra of [{}, { subagentType: "scout" }]) {
    const read = jobCommand(ws, `--job exec --query ${quoteQuery(`sed -n 1,200p ${ws}/src/a.ts`)}`);
    expect(bash(read, extra)).toBeNull();
    expect(bash(`bun repo job --job exec --query ${quoteQuery("cat src/a.ts")}`, extra)).toBeNull();
  }
  const denied = jobCommand(ws, `--job exec --query ${quoteQuery("cat node_modules/x/y.js")}`);
  expect(bash(denied)).toMatchObject({ type: "deny" });
  expect(bash(`cat ${ws}/node_modules/x/y.js`)).toMatchObject({ type: "deny" });
});

it("matches the bin through a symlinked checkout", () => {
  const real = tmp.dir("gate-bin-");
  fs.mkdirSync(path.join(real, "bin"));
  fs.writeFileSync(path.join(real, "bin", "repo.ts"), "");
  fs.mkdirSync(path.join(real, "node_modules", ".bin"), { recursive: true });
  fs.symlinkSync(path.join("..", "..", "bin", "repo.ts"), path.join(real, "node_modules", ".bin", "repo"));
  const alias = `${real}-alias`;
  fs.symlinkSync(real, alias);
  const roots = { checkout: real, cwd: real, root: real };
  expect(isWorkspaceJobScript(`${alias}/node_modules/.bin/repo job ${JOB}`, roots)).toBe(true);
  expect(isWorkspaceJobScript(jobCommand(real, JOB), roots)).toBe(true);
  expect(isWorkspaceJobScript(`${real}/bin/repo.ts job ${JOB}`, roots)).toBe(true);
  expect(isWorkspaceJobScript(`${alias}/node_modules/.bin/other job ${JOB}`, roots)).toBe(false);
});

it("matches the bin in a path.win32 checkout", () => {
  const roots = { checkout: "C:\\r", cwd: "C:\\r\\sub", root: "C:\\r" };
  function ok(c: string) {
    return isWorkspaceJobScript(c, roots, path.win32);
  }
  expect(ok(`C:\\r\\node_modules\\.bin\\repo job ${JOB}`)).toBe(true);
  expect(ok(`..\\node_modules\\.bin\\repo job ${JOB}`)).toBe(true);
  expect(ok(`C:\\bun\\bin\\bun.exe C:\\r\\node_modules\\.bin\\repo job ${JOB}`)).toBe(true);
  expect(ok(`C:\\r\\node_modules\\.bin\\repo.exe job ${JOB}`)).toBe(true);
  expect(ok(`D:\\r\\node_modules\\.bin\\repo job ${JOB}`)).toBe(false);
});

it("refuses the old job script, under both path flavors", () => {
  const posix = { checkout: "/r", cwd: "/r/sub", root: "/r" };
  const win = { checkout: "C:\\r", cwd: "C:\\r", root: "C:\\r" };
  expect(isWorkspaceJobScript(`bun /r/cli/scripts/job.ts ${JOB}`, posix, path.posix)).toBe(false);
  expect(isWorkspaceJobScript(`rtk bun ../cli/scripts/job.ts ${JOB}`, posix, path.posix)).toBe(false);
  expect(isWorkspaceJobScript(`bun C:\\r\\cli\\scripts\\job.ts ${JOB}`, win, path.win32)).toBe(false);
});
