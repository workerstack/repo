import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { A, B, C, cleanRigs, rig } from "./__fixtures__/push-gate-rig.ts";
import { MAX_PUSH_BLOCK, pushStopBlock } from "./ci-push-gate.ts";

afterEach(cleanRigs);

function wait(branch: string) {
  return `\`bun repo ci wait ${branch}\``;
}

function noResult(sha: string, branch = "main") {
  return (
    `Stop: you pushed ${sha.slice(0, 7)} to ${branch} and its ci run has no result; ` +
    `run ${wait(branch)} in the background and fix it if it fails`
  );
}

const REPORT =
  "Stop: test (windows-latest) failed 3 times on main this session; " +
  "report the failure and its logs to the user, then stop";

const TEST = ["test (windows-latest)"];

/** A rig where the session pushed each of `rows`. */
function pushed(rows: [string, string][], over = {}) {
  const r = rig(over);
  r.plant("s1", rows);

  return r;
}

it("passes when the session pushed nothing or has no id", () => {
  expect(rig().gate()).toBeNull();
  expect(rig().gate("")).toBeNull();
});

it("blocks a push that has no record", () => {
  expect(pushed([["main", A]]).gate()).toBe(noResult(A));
});

it.each(["passed", "nothing", "error"] as const)("passes a push whose record says %s", (outcome) => {
  const r = pushed([["main", A]]);
  r.result(A, outcome);
  expect(r.gate()).toBeNull();
});

it("blocks a push whose run was superseded", () => {
  const r = pushed([["main", A]]);
  r.result(A, "superseded");
  expect(r.gate()).toBe(noResult(A));
});

it("passes when a superseded push was followed by a passed one", () => {
  const r = pushed([
    ["main", A],
    ["main", B],
  ]);

  r.result(A, "superseded");
  r.result(B, "passed");
  expect(r.gate()).toBeNull();
});

it("settles an older failed push by a newer passed one", () => {
  const r = pushed([
    ["main", A],
    ["main", B],
  ]);

  r.result(A, "failed", ["test"]);
  r.result(B, "passed");
  expect(r.gate()).toBeNull();
});

it("drops a rejected push and settles on the newest one that landed", () => {
  const r = pushed(
    [
      ["main", A],
      ["main", B],
    ],
    { landed: { main: [A] } },
  );

  r.result(A, "passed");
  expect(r.gate()).toBeNull();
  expect(pushed([["main", A]], { landed: {} }).gate()).toBeNull();
});

it("holds each branch to its own newest push and joins the lines", () => {
  const r = pushed([
    ["main", A],
    ["x", C],
  ]);

  expect(r.gate()).toBe(`${noResult(A)}\n${noResult(C, "x")}`);
  r.result(A, "passed");
  expect(r.gate()).toBe(noResult(C, "x"));
});

it("treats a record it cannot read as no record", () => {
  const r = pushed([["main", A]]);
  r.result(A, "passed");
  fs.writeFileSync(path.join(r.main, `.repo/tmp/ci/${A}.json`), '{"outcome":"weird"}');
  expect(r.gate()).toBe(noResult(A));
});

it("asks a failed push to be fixed and pushed again before the third failed round", () => {
  const r = pushed([
    ["main", A],
    ["main", B],
  ]);

  r.result(B, "failed", TEST);
  expect(r.gate()).toBe(
    `Stop: ci failed on ${B.slice(0, 7)} on main (test (windows-latest)); ` +
      `fix it in a new worktree, push, and run ${wait("main")} in the background`,
  );
});

function threeRounds() {
  const r = pushed([
    ["main", A],
    ["main", B],
    ["main", C],
  ]);

  r.result(A, "failed", [...TEST, "lint"]);
  r.result(B, "failed", TEST);
  r.result(C, "failed", [...TEST, "build"]);

  return r;
}

it("blocks three failed rounds with the report line naming the shared job", () => {
  expect(threeRounds().gate()).toBe(REPORT);
});

it("does not repeat the report once the host says the stop hook already ran", () => {
  expect(threeRounds().gate("s1", true)).toBeNull();
});

it("counts a sha pushed twice once", () => {
  const r = pushed([
    ["main", A],
    ["main", A],
    ["main", B],
  ]);

  r.result(A, "failed", ["test"]);
  r.result(B, "failed", ["test"]);
  expect(r.gate()).not.toContain("failed 3 times");
});

it("does not count failures that share no job", () => {
  const r = pushed([
    ["main", A],
    ["main", B],
    ["main", C],
  ]);

  r.result(A, "failed", ["lint"]);
  r.result(B, "failed", ["test"]);
  r.result(C, "failed", ["build"]);
  expect(r.gate()).not.toContain("failed 3 times");
});

it("does not count records of another session's pushes", () => {
  const r = pushed([
    ["main", A],
    ["main", B],
  ]);

  r.plant("s2", [["main", C]]);

  for (const sha of [A, B, C]) r.result(sha, "failed", ["test"]);
  expect(r.gate("s1")).not.toContain("failed 3 times");
  expect(r.gate("s2")).not.toContain("failed 3 times");
});

it("lets the stop through after six blocks, counted on its own stamp", () => {
  const r = pushed([["main", A]]);

  for (let i = 0; i < MAX_PUSH_BLOCK; i++) expect(r.gate()).toBe(noResult(A));
  expect(r.gate()).toBeNull();
  expect(fs.readFileSync(r.stamp(), "utf8")).toBe(String(MAX_PUSH_BLOCK));
});

it("does not count a stop that passes, nor spend the ask and away count", () => {
  const r = rig();
  r.gate();
  expect(fs.existsSync(r.stamp())).toBe(false);
  r.plant("s1", [["main", A]]);
  fs.mkdirSync(path.dirname(r.stamp()), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(r.stamp()), "stop-block-s1"), "3");
  expect(r.gate()).toBe(noResult(A));
});

it("starts from zero when the stamp holds no number", () => {
  const r = pushed([["main", A]]);
  fs.mkdirSync(path.dirname(r.stamp()), { recursive: true });
  fs.writeFileSync(r.stamp(), "junk");
  expect(r.gate()).toBe(noResult(A));
  expect(fs.readFileSync(r.stamp(), "utf8")).toBe("1");
});

it("blocks without counting when the stamp cannot be written", () => {
  const r = pushed([["main", A]]);

  const deny = {
    ...fs,
    writeFileSync: () => {
      throw new Error("disk full");
    },
  };

  const input = { active: false, cwd: r.main, root: r.main, session: "s1" };
  expect(pushStopBlock(input, { ...r.deps, fs: deny })).toBe(noResult(A));
});
