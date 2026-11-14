import path from "node:path";

import { expect, it } from "vitest";

import { useCapturedRun } from "../__fixtures__/captured-run.ts";
import { doc, item, journal, outOf, run, session, setup } from "./__fixtures__/su-kit.ts";

const captured = useCapturedRun();

function out(): string {
  return outOf(captured);
}

type Spec = { boxes: string; serial: string; status: string };

function work(root: string, [dir, name]: [string, string], d: Spec): string {
  return item(root, { dir, name: `${d.serial}-w.md`, text: doc({ ...d, name }) });
}

function plan(root: string, name: string, d: Spec): string {
  return work(root, ["plans", name], d);
}

it("prints the session's items in approvals order, fast ones included, and skips a deleted file", () => {
  const { root, roots } = setup(captured.temps);
  const threeDone = "1 [x] a\n2 [x] b\n3 [x] c";
  const fast = work(root, ["plans-fast", "fix-ci-cache"], { boxes: threeDone, serial: "4", status: "done" });
  const road = work(root, ["roadmaps", "big-road"], { boxes: "1 [x] s\n2 [ ] t", serial: "12", status: "in-progress" });
  const rapid = work(root, ["roadmaps-fast", "quick"], { boxes: "1 [ ] z", serial: "5", status: "draft" });
  const deep = plan(root, "jsonc", { boxes: "1 [x] only", serial: "199", status: "done" });
  const gone = path.join(root, ".repo", "plans", "gone.md");

  session(root, "sid1", [fast, road, gone, deep, rapid]);

  expect(run(roots, "--session", "sid1")).toBe(0);
  expect(out()).toBe(
    [
      "fast plan 4 fix-ci-cache: done, 3 of 3 boxes",
      "roadmap 12 big-road: in-progress, 1 of 2 boxes",
      "plan 199 jsonc: done, 1 of 1 boxes",
      "fast roadmap 5 quick: draft, 0 of 1 boxes",
      "",
    ].join("\n"),
  );
});

it("counts leaf boxes only, so a phase with children counts its children", () => {
  const { root, roots } = setup(captured.temps);

  const boxes = [
    "1 [ ] Phase one",
    "1.1 [x] a",
    "1.2 [X] b",
    "2 [x] Phase two",
    "2.1 [ ] c",
    "2.2 [ ] d",
    "3 [ ] Lone phase",
    "  3.1 [x] nested",
    "4 [ ] Four",
    "4.1 [ ] x",
    "4.1.1 [x] y",
    "4.1.2 [x] z",
    "41 [ ] Not a child of 4",
  ].join("\n");

  session(root, "s", [plan(root, "counted", { boxes, serial: "1", status: "in-progress" })]);
  run(roots, "--session", "s");

  expect(out()).toBe("plan 1 counted: in-progress, 5 of 8 boxes\n");
});

it("shows a plan's journal blockers joined, and ignores (none) and a journal for another plan", () => {
  const { root, roots } = setup(captured.temps);
  const one = plan(root, "blocked-one", { boxes: "1 [ ] a", serial: "7", status: "blocked" });
  const two = plan(root, "clear-one", { boxes: "1 [ ] a", serial: "8", status: "in-progress" });
  const three = plan(root, "no-journal", { boxes: "1 [ ] a", serial: "9", status: "in-progress" });

  journal(root, "7", "- first problem\n- second problem");
  journal(root, "8", "- (none)");
  item(root, { dir: "implementations", name: "plain.md", text: "no frontmatter here\n" });
  session(root, "s", [one, two, three]);
  run(roots, "--session", "s");

  expect(out()).toBe(
    [
      "plan 7 blocked-one: blocked, 0 of 1 boxes; blocker: first problem; blocker: second problem",
      "plan 8 clear-one: in-progress, 0 of 1 boxes",
      "plan 9 no-journal: in-progress, 0 of 1 boxes",
      "",
    ].join("\n"),
  );
});

it("shows no blocker for a roadmap even when a journal names its serial", () => {
  const { root, roots } = setup(captured.temps);

  const road = work(root, ["roadmaps", "road"], { boxes: "1 [ ] a", serial: "7", status: "locked" });

  journal(root, "7", "- stuck");
  session(root, "s", [road]);
  run(roots, "--session", "s");

  expect(out()).toBe("roadmap 7 road: locked, 0 of 1 boxes\n");
});

it("reads a journal with no Blockers section, or one that is last, correctly", () => {
  const { root, roots } = setup(captured.temps);
  const one = plan(root, "x", { boxes: "1 [ ] a", serial: "7", status: "ready" });
  const two = plan(root, "y", { boxes: "1 [ ] a", serial: "8", status: "blocked" });

  item(root, { dir: "implementations", name: "7-j.md", text: "---\nplan: 7\n---\n\n## Notes\n- y\n" });
  item(root, { dir: "implementations", name: "8-j.md", text: "---\nplan: 8\n---\n\n## Blockers\n- last one\n" });
  session(root, "s", [one, two]);
  run(roots, "--session", "s");

  expect(out()).toBe("plan 7 x: ready, 0 of 1 boxes\nplan 8 y: blocked, 0 of 1 boxes; blocker: last one\n");
});

it("falls back to the file name and a question mark when the frontmatter is missing", () => {
  const { root, roots } = setup(captured.temps);

  session(root, "s", [item(root, { dir: "plans", name: "bare.md", text: "just text\n" })]);
  run(roots, "--session", "s");

  expect(out()).toBe("plan ? bare: ?, 0 of 0 boxes\n");
});

it("ignores approvals lines outside the four work dirs", () => {
  const { root, roots } = setup(captured.temps);
  const other = item(root, { dir: "handoffs", name: "h.md", text: "x\n" });
  const kept = plan(root, "kept", { boxes: "1 [x] a", serial: "1", status: "done" });

  session(root, "s", [other, kept]);
  run(roots, "--session", "s");

  expect(out()).toBe("plan 1 kept: done, 1 of 1 boxes\n");
});

it("says a session with no approvals, or only a deleted file, saved nothing", () => {
  const { root, roots } = setup(captured.temps);

  expect(run(roots, "--session", "none")).toBe(0);
  session(root, "gone", [path.join(root, ".repo", "plans", "x.md")]);
  expect(run(roots, "--session", "gone")).toBe(0);
  expect(captured.out).toStrictEqual([
    "repo su: session none saved no plan or roadmap\n",
    "repo su: session gone saved no plan or roadmap\n",
  ]);
});
