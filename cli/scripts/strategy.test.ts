import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import {
  activeReview,
  closingLine,
  ENFORCED_HARNESSES,
  implementerOf,
  MODES,
  parseApproval,
  parseClosingLine,
  parseMode,
  parseStrategy,
  STRATEGIES,
  stampPath,
  writeStamp,
} from "./strategy.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) for (const x of [d, `${d}-alias`]) fs.rmSync(x, { force: true, recursive: true });
});

function tmpRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "strategy-")));
  tmpDirs.push(dir);
  return dir;
}

function writePlan(root: string, name: string, fm: Record<string, string>) {
  const abs = path.join(root, ".tmp", "repo", "plans", name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const head = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  fs.writeFileSync(abs, `---\n${head}\n---\n\n# plan\n`);
  return abs;
}

const planFm = (strategy: string | null, status = "in-progress") => ({
  name: "x",
  serial: "4",
  status,
  ...(strategy == null ? {} : { strategy }),
});

describe("parseStrategy", () => {
  it("accepts exactly the three values", () => {
    expect(STRATEGIES).toStrictEqual(["default", "review-fast", "review-deep"]);
    for (const s of STRATEGIES) expect(parseStrategy(s)).toBe(s);
    for (const bad of ["review-medium", "Default", " default", "", undefined, null, 3, ["default"]])
      expect(parseStrategy(bad)).toBeNull();
  });
});

describe("implementerOf", () => {
  it("review-fast starts fast then goes deep; review-deep is deep both times", () => {
    expect(implementerOf("review-fast", 1)).toBe("implementer-fast");
    expect(implementerOf("review-fast", 2)).toBe("implementer-deep");
    expect(implementerOf("review-deep", 1)).toBe("implementer-deep");
    expect(implementerOf("review-deep", 2)).toBe("implementer-deep");
  });
});

describe("closingLine", () => {
  it("renders a single item with the other two values as the or list", () => {
    expect(closingLine([{ kind: "plan", serial: 4, strategy: "review-fast" }])).toBe(
      'Reply "y" to run plan 4 (strategy: review-fast), or "y default" / "y review-deep", or "h" / "h fast" / "h deep" for a fresh session.',
    );
  });

  it("renders a mixed queue with every value in the or list", () => {
    expect(
      closingLine([
        { kind: "plan", serial: 4, strategy: "review-fast" },
        { kind: "plan", serial: 5, strategy: "default" },
      ]),
    ).toBe(
      'Reply "y" to run plan 4 (strategy: review-fast), then plan 5 (strategy: default), or "y default" / "y review-fast" / "y review-deep", or "h" / "h fast" / "h deep" for a fresh session.',
    );
  });

  it("leaves out the value every item already holds", () => {
    expect(
      closingLine([
        { kind: "plan", serial: 1, strategy: "default" },
        { kind: "roadmap", serial: 2, strategy: "default" },
      ]),
    ).toBe(
      'Reply "y" to run plan 1 (strategy: default), then roadmap 2 (strategy: default), or "y review-fast" / "y review-deep", or "h" / "h fast" / "h deep" for a fresh session.',
    );
  });

  it("offers the fresh-session handoffs after the strategy choices", () => {
    expect(closingLine([{ kind: "plan", serial: 18, strategy: "review-deep" }])).toBe(
      'Reply "y" to run plan 18 (strategy: review-deep), or "y default" / "y review-fast", or "h" / "h fast" / "h deep" for a fresh session.',
    );
  });

  it("refuses an empty queue", () => {
    expect(() => closingLine([])).toThrow();
  });
});

describe("parseClosingLine", () => {
  const queues = [
    [{ kind: "plan", serial: 4, strategy: "review-fast" }],
    [
      { kind: "plan", serial: 4, strategy: "review-fast" },
      { kind: "roadmap", serial: 5, strategy: "default" },
      { kind: "plan", serial: 6, strategy: "review-deep" },
    ],
    [
      { kind: "plan", serial: 1, strategy: "default" },
      { kind: "plan", serial: 2, strategy: "default" },
    ],
  ];

  it("round-trips what closingLine renders", () => {
    for (const q of queues) expect(parseClosingLine(closingLine(q as never))).toStrictEqual(q);
  });

  it("strips markdown wrapping the way a bold or quoted line arrives", () => {
    const q = queues[2];
    expect(parseClosingLine(`**${closingLine(q as never)}**`)).toStrictEqual(q);
    expect(parseClosingLine(`> \`${closingLine(q as never)}\` `)).toStrictEqual(q);
  });

  it("returns null for a hand-edited or legacy line", () => {
    const line = closingLine(queues[0] as never);
    expect(parseClosingLine(line.replace('"y default" / "y review-deep"', '"y review-deep"'))).toBeNull();
    expect(parseClosingLine(line.replace("review-fast", "review-medium"))).toBeNull();
    expect(parseClosingLine('Reply "y" to run plan 4.')).toBeNull();
    expect(
      parseClosingLine('Reply "y" to run plan 4 (strategy: review-fast), or "y default" / "y review-deep".'),
    ).toBeNull();
    expect(parseClosingLine(line.replace(' / "h deep"', ""))).toBeNull();
    expect(parseClosingLine("")).toBeNull();
    expect(parseClosingLine("Reply y")).toBeNull();
  });
});

describe("parseApproval", () => {
  it("maps y in any case with no strategy to keep each file's value", () => {
    expect(parseApproval("y")).toStrictEqual({ kind: "approve", strategy: null });
    expect(parseApproval("Y")).toStrictEqual({ kind: "approve", strategy: null });
  });

  it("maps a strategy word, ignoring extra spaces", () => {
    expect(parseApproval("y review-deep")).toStrictEqual({ kind: "approve", strategy: "review-deep" });
    expect(parseApproval("y  default ")).toStrictEqual({ kind: "approve", strategy: "default" });
  });

  it("names an unknown word", () => {
    expect(parseApproval("y review-medium")).toStrictEqual({ kind: "unknown", word: "review-medium" });
  });

  it("maps h, h fast and h deep in any case to a handoff", () => {
    expect(parseApproval("h")).toStrictEqual({ kind: "handoff", strategy: null });
    expect(parseApproval("H")).toStrictEqual({ kind: "handoff", strategy: null });
    expect(parseApproval("h fast")).toStrictEqual({ kind: "handoff", strategy: "review-fast" });
    expect(parseApproval(" H  Deep ")).toStrictEqual({ kind: "handoff", strategy: "review-deep" });
  });

  it("names an unknown h word", () => {
    expect(parseApproval("h slow")).toStrictEqual({ kind: "unknown", word: "slow" });
    expect(parseApproval("h review-fast")).toStrictEqual({ kind: "unknown", word: "review-fast" });
    expect(parseApproval("h constructor")).toStrictEqual({ kind: "unknown", word: "constructor" });
  });

  it("is null for anything that is not a y or h reply", () => {
    for (const p of ["yes please", "", "n", "y review-deep now", "ya", "hi", "h fast now", "help"])
      expect(parseApproval(p)).toBeNull();
  });
});

describe("parseMode", () => {
  it("accepts exactly ask, auto and away", () => {
    expect(MODES).toStrictEqual(["ask", "auto", "away"]);
    for (const m of MODES) expect(parseMode(m)).toBe(m);
    for (const bad of ["Away", " ask", "", "review", undefined, null, 1, ["auto"]]) expect(parseMode(bad)).toBeNull();
  });
});

describe("stamp", () => {
  it("stampPath keeps the sid inside the sessions dir", () => {
    const root = tmpRoot();
    expect(stampPath(root, "abc-1")).toBe(path.join(root, ".tmp", "repo", "sessions", "abc-1", "strategy.json"));
    expect(
      path.relative(path.join(root, ".tmp", "repo", "sessions"), stampPath(root, "../../x")).startsWith(".."),
    ).toBe(false);
  });

  it("writeStamp then activeReview returns an in-progress review-fast plan", () => {
    const root = tmpRoot();
    const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("review-fast"));
    writeStamp(root, "s1", plan);
    expect(activeReview(root, "s1")).toStrictEqual({ plan, serial: 4, strategy: "review-fast" });
  });

  it("is null for ready, done, blocked, default, a missing key, a missing plan and an unstamped session", () => {
    const root = tmpRoot();
    for (const [fm, label] of [
      [planFm("review-fast", "ready"), "ready"],
      [planFm("review-fast", "done"), "done"],
      [planFm("review-fast", "blocked"), "blocked"],
      [planFm("default"), "default"],
      [planFm(null), "nokey"],
    ] as const) {
      const plan = writePlan(root, `4-${label}-20261107T181901Z.md`, fm);
      writeStamp(root, label, plan);
      expect(activeReview(root, label)).toBeNull();
    }
    writeStamp(root, "gone", path.join(root, ".tmp", "repo", "plans", "9-gone-20261107T181901Z.md"));
    expect(activeReview(root, "gone")).toBeNull();
    expect(activeReview(root, "never-stamped")).toBeNull();
  });

  it("follows the plan file: a done plan ends the review with the stamp still there", () => {
    const root = tmpRoot();
    const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("review-deep"));
    writeStamp(root, "s1", plan);
    expect(activeReview(root, "s1")?.strategy).toBe("review-deep");
    writePlan(root, "4-x-20261107T181901Z.md", planFm("review-deep", "done"));
    expect(fs.existsSync(stampPath(root, "s1"))).toBe(true);
    expect(activeReview(root, "s1")).toBeNull();
  });

  it("is null for a corrupt stamp", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.dirname(stampPath(root, "s1")), { recursive: true });
    fs.writeFileSync(stampPath(root, "s1"), "{not json");
    expect(activeReview(root, "s1")).toBeNull();
  });

  it("writeStamp twice leaves one identical file and no temp file", () => {
    const root = tmpRoot();
    const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("review-fast"));
    writeStamp(root, "s1", plan);
    const first = fs.readFileSync(stampPath(root, "s1"), "utf8");
    writeStamp(root, "s1", plan);
    expect(fs.readFileSync(stampPath(root, "s1"), "utf8")).toBe(first);
    expect(fs.readdirSync(path.dirname(stampPath(root, "s1")))).toStrictEqual(["strategy.json"]);
  });

  it("stamps a plan typed with ./ or .. as its canonical path", () => {
    const root = tmpRoot();
    const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("review-fast"));
    writeStamp(root, "s1", `${root}/./.tmp/repo/../repo/plans/4-x-20261107T181901Z.md`);
    expect(JSON.parse(fs.readFileSync(stampPath(root, "s1"), "utf8"))).toStrictEqual({ plan });
  });

  it("stamps through a symlinked spelling of the root and finds the plan", () => {
    const root = tmpRoot();
    const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("review-fast"));
    const alias = aliasOf(root);
    writeStamp(alias, "s1", path.join(alias, ".tmp", "repo", "plans", "4-x-20261107T181901Z.md"));
    expect(JSON.parse(fs.readFileSync(stampPath(root, "s1"), "utf8"))).toStrictEqual({ plan });
    expect(activeReview(alias, "s1")).toStrictEqual({ plan, serial: 4, strategy: "review-fast" });
    expect(activeReview(root, "s1")?.plan).toBe(plan);
  });
});

describe("ENFORCED_HARNESSES", () => {
  it("holds the harnesses whose live child payload carries a marker the gate reads: claude (and Grok through it) and codex", () => {
    expect([...ENFORCED_HARNESSES].sort()).toStrictEqual(["claude", "codex"]);
  });
});
