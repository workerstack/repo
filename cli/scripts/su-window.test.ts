import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { useCapturedRun } from "../__fixtures__/captured-run.ts";
import { doc, item, outOf, run, session, setup } from "./__fixtures__/su-kit.ts";

const captured = useCapturedRun();

function out(): string {
  return outOf(captured);
}

function put(root: string, spec: { agoH: number; dir: string; n: number }): void {
  const { agoH, dir, n } = spec;
  const text = doc({ boxes: "1 [x] a", name: `item${n}`, serial: String(n), status: "done" });

  item(root, { agoH, dir, name: `${n}-x.md`, text });
}

it("lists only files changed in the window, newest first, then the window's commits", () => {
  const { root, roots } = setup(captured.temps, [
    ["2026-11-13T10:00:00Z", "too old"],
    ["2026-11-13T21:00:00Z", "feat(a): in the window"],
    ["2026-11-14T01:30:00Z", "fix(b)!: newer one"],
  ]);

  put(root, { agoH: 9, dir: "plans", n: 1 });
  put(root, { agoH: 5, dir: "plans", n: 2 });
  put(root, { agoH: 1, dir: "roadmaps", n: 3 });
  put(root, { agoH: 3, dir: "plans-fast", n: 4 });
  put(root, { agoH: 7, dir: "roadmaps-fast", n: 5 });
  item(root, { dir: "plans", name: "notes.txt", text: "not markdown" });

  expect(run(roots, "8h")).toBe(0);

  const lines = out().trimEnd().split("\n");

  expect(lines.slice(0, 5)).toStrictEqual([
    "since 2026-11-13T19:02Z (8h):",
    "roadmap 3 item3: done, 1 of 1 boxes",
    "fast plan 4 item4: done, 1 of 1 boxes",
    "plan 2 item2: done, 1 of 1 boxes",
    "fast roadmap 5 item5: done, 1 of 1 boxes",
  ]);
  expect(lines).toHaveLength(7);
  expect(lines[5]).toMatch(/^commit [0-9a-f]{4,} fix\(b\)!: newer one$/);
  expect(lines[6]).toMatch(/^commit [0-9a-f]{4,} feat\(a\): in the window$/);
});

it("prints the whole window, not the session, when both are given in either order", () => {
  const { root, roots } = setup(captured.temps);
  const text = doc({ boxes: "", name: "own", serial: "1", status: "done" });
  const own = item(root, { dir: "plans", name: "1-a.md", text });

  put(root, { agoH: 1, dir: "plans", n: 2 });
  session(root, "s", [own]);

  expect(run(roots, "--session", "s", "2h")).toBe(0);
  expect(out()).toContain("plan 1 own");
  expect(out()).toContain("plan 2 item2");
  captured.out.length = 0;
  expect(run(roots, "2h", "--session", "s")).toBe(0);
  expect(out()).toContain("plan 2 item2");
});

it("reads overnight as 12 hours and the other units as minutes, hours and days", () => {
  const { root, roots } = setup(captured.temps);

  put(root, { agoH: 11, dir: "plans", n: 1 });
  put(root, { agoH: 13, dir: "plans", n: 2 });
  run(roots, "overnight");
  expect(out()).toBe("since 2026-11-13T15:02Z (overnight):\nplan 1 item1: done, 1 of 1 boxes\n");
  captured.out.length = 0;
  run(roots, "90m");
  expect(out()).toBe("since 2026-11-14T01:32Z (90m): nothing changed\n");
  captured.out.length = 0;
  run(roots, "2d");
  expect(out()).toContain("since 2026-11-12T03:02Z (2d):\nplan 1 item1");
});

it("says nothing changed for a window with no items and no commits", () => {
  const { roots } = setup(captured.temps);

  expect(run(roots, "8h")).toBe(0);
  expect(out()).toBe("since 2026-11-13T19:02Z (8h): nothing changed\n");
});

it("lists commits with no items", () => {
  const { roots } = setup(captured.temps, [["2026-11-14T02:30:00Z", "chore: only a commit"]]);

  expect(run(roots, "1h")).toBe(0);
  expect(out()).toMatch(/^since 2026-11-14T02:02Z \(1h\):\ncommit [0-9a-f]+ chore: only a commit\n$/);
});

it("prints no commit lines outside a git repo", () => {
  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "su-plain-")));

  captured.temps.push(plain);
  put(plain, { agoH: 1, dir: "plans", n: 1 });

  expect(run({ checkout: plain, cwd: plain, root: plain }, "8h")).toBe(0);
  expect(out()).toBe("since 2026-11-13T19:02Z (8h):\nplan 1 item1: done, 1 of 1 boxes\n");
});
