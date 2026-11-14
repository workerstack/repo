import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { A, B, C, cleanRigs, failedLine, rig } from "./__fixtures__/push-gate-rig.ts";

afterEach(cleanRigs);

const { tempDir: otherDir } = useTempDirs("push-gate-wt-");

const CONSUMER = "consumer";
const UBUNTU = "test (ubuntu-latest 1/2)";
const WINDOWS = "test (windows-latest)";

/** A rig where the session's one push to main at A failed `jobs`. */
function failedOn(jobs: string[]) {
  const r = rig();
  r.plant("s1", [["main", A]]);
  r.result(A, "failed", jobs);

  return r;
}

it.each([
  ["LF", "\n"],
  ["CRLF", "\r\n"],
])("passes a failed run whose every job is on an open blocked line (%s)", (_name, eol) => {
  const r = failedOn([CONSUMER, UBUNTU]);

  const lines = [
    "# Backlog",
    "",
    `- [ ] blocked: \`${CONSUMER}\` needs an npm trusted publisher only the owner can add`,
    `- [-] blocked: \`${UBUNTU}\` runner image is down`,
    "",
  ];

  r.backlog(lines.join(eol));
  expect(r.gate()).toBeNull();
});

it.each([
  ["a done line", `- [x] blocked: \`${CONSUMER}\` fixed`],
  ["an indented line", `  - [ ] blocked: \`${CONSUMER}\` why`],
  ["a * bullet", `* [ ] blocked: \`${CONSUMER}\` why`],
  ["a mention without the blocked shape", `- [ ] look at \`${CONSUMER}\` again`],
  ["a blocked line naming another job", `- [ ] blocked: \`${CONSUMER}x\` why`],
])("still blocks a failed run when the backlog has only %s", (_name, line) => {
  const r = failedOn([CONSUMER]);
  r.backlog(`${line}\n`);
  expect(r.gate()).toBe(failedLine(A, CONSUMER));
});

it("still blocks a failed run when the backlog is missing or unreadable", () => {
  const r = failedOn([CONSUMER]);
  expect(r.gate()).toBe(failedLine(A, CONSUMER));
  fs.mkdirSync(path.join(r.main, ".repo/backlog.md"), { recursive: true });
  expect(r.gate()).toBe(failedLine(A, CONSUMER));
});

it("reads only the root's backlog, not a copy in another checkout", () => {
  const r = failedOn([CONSUMER]);
  r.backlog(`- [ ] blocked: \`${CONSUMER}\` why\n`, otherDir());
  expect(r.gate()).toBe(failedLine(A, CONSUMER));
});

it("never releases a failed record with an empty job list", () => {
  const r = failedOn([]);
  r.backlog(`- [ ] blocked: \`${CONSUMER}\` why\n`);
  expect(r.gate()).toBe(failedLine(A, ""));
});

it("names only the jobs no open blocked line covers", () => {
  const r = failedOn([CONSUMER, UBUNTU]);
  r.backlog(`- [ ] blocked: \`${CONSUMER}\` needs an npm trusted publisher only the owner can add\n`);
  expect(r.gate()).toBe(failedLine(A, UBUNTU));
});

it("does not report three failures of a blocked job", () => {
  const r = rig();
  r.plant("s1", [
    ["main", A],
    ["main", B],
    ["main", C],
  ]);

  for (const sha of [A, B]) r.result(sha, "failed", [WINDOWS]);
  r.result(C, "failed", [WINDOWS, "build"]);
  expect(r.gate()).toMatch(/failed 3 times/u);
  r.backlog(`- [ ] blocked: \`${WINDOWS}\` why\n`);
  expect(r.gate()).toBe(failedLine(C, "build"));
  r.result(C, "failed", [WINDOWS]);
  expect(r.gate()).toBeNull();
});
