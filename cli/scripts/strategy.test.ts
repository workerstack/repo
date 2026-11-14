import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { realDir } from "./__fixtures__/real-dir.ts";
import { ENFORCED_HARNESSES, APPROVALS, STRATEGIES } from "./strategy.constants.ts";
import {
  activeReview,
  hasStrategy,
  implementerOf,
  kindHasStrategy,
  parseApprovalSetting,
  parseStrategy,
  stampPath,
  writeStamp,
} from "./strategy.ts";

useTempDirs();

function writePlan(root: string, name: string, fm: Record<string, string>): string {
  const abs = path.join(root, ".repo", "plans", name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const head = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  fs.writeFileSync(abs, `---\n${head}\n---\n\n# plan\n`);

  return abs;
}

/** A plan's frontmatter with `strategy` (left out when null) and `status`. */
function planFm(strategy: string | null, status = "in-progress") {
  return { name: "x", serial: "4", status, ...(strategy == null ? {} : { strategy }) };
}

it("accepts exactly the three values", () => {
  expect(STRATEGIES).toStrictEqual(["free", "spawn-fast", "spawn-deep"]);

  for (const s of STRATEGIES) expect(parseStrategy(s)).toBe(s);

  for (const bad of ["review-fast", "review-deep", "review-medium", "Free", " free", "default", "", undefined])
    expect(parseStrategy(bad)).toBeNull();
});

it("spawn-fast starts fast then goes deep; spawn-deep is deep both times", () => {
  expect(implementerOf("spawn-fast", 1)).toBe("implementer-fast");
  expect(implementerOf("spawn-fast", 2)).toBe("implementer-deep");
  expect(implementerOf("spawn-deep", 1)).toBe("implementer-deep");
  expect(implementerOf("spawn-deep", 2)).toBe("implementer-deep");
});

it("accepts exactly ask and away", () => {
  expect(APPROVALS).toStrictEqual(["ask", "away"]);

  for (const m of APPROVALS) expect(parseApprovalSetting(m)).toBe(m);

  for (const bad of ["auto", "Away", " ask", "", "review", undefined]) expect(parseApprovalSetting(bad)).toBeNull();
});

it("stampPath keeps the sid inside the sessions dir", () => {
  const root = realDir("strategy-");
  expect(stampPath(root, "abc-1")).toBe(path.join(root, ".repo", "tmp", "sessions", "abc-1", "strategy.json"));
  expect(path.relative(path.join(root, ".repo", "tmp", "sessions"), stampPath(root, "../../x")).startsWith("..")).toBe(
    false,
  );
});

it("writeStamp then activeReview returns an in-progress spawn-fast plan", () => {
  const root = realDir("strategy-");
  const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("spawn-fast"));
  writeStamp(root, "s1", plan);
  expect(activeReview(root, "s1")).toStrictEqual({ plan, serial: 4, strategy: "spawn-fast" });
});

it("is null for ready, done, blocked, free, a missing key, a missing plan and an unstamped session", () => {
  const root = realDir("strategy-");

  for (const [fm, label] of [
    [planFm("spawn-fast", "ready"), "ready"],
    [planFm("spawn-fast", "done"), "done"],
    [planFm("spawn-fast", "blocked"), "blocked"],
    [planFm("free"), "free"],
    [planFm(null), "nokey"],
  ] as const) {
    const plan = writePlan(root, `4-${label}-20261107T181901Z.md`, fm);
    writeStamp(root, label, plan);
    expect(activeReview(root, label)).toBeNull();
  }

  writeStamp(root, "gone", path.join(root, ".repo", "plans", "9-gone-20261107T181901Z.md"));
  expect(activeReview(root, "gone")).toBeNull();
  expect(activeReview(root, "never-stamped")).toBeNull();
});

it("follows the plan file: a done plan ends the review with the stamp still there", () => {
  const root = realDir("strategy-");
  const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("spawn-deep"));
  writeStamp(root, "s1", plan);
  expect(activeReview(root, "s1")?.strategy).toBe("spawn-deep");
  writePlan(root, "4-x-20261107T181901Z.md", planFm("spawn-deep", "done"));
  expect(fs.existsSync(stampPath(root, "s1"))).toBe(true);
  expect(activeReview(root, "s1")).toBeNull();
});

it("is null for a corrupt stamp", () => {
  const root = realDir("strategy-");
  fs.mkdirSync(path.dirname(stampPath(root, "s1")), { recursive: true });
  fs.writeFileSync(stampPath(root, "s1"), "{not json");
  expect(activeReview(root, "s1")).toBeNull();
});

it("writeStamp twice leaves one identical file and no temp file", () => {
  const root = realDir("strategy-");
  const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("spawn-fast"));
  writeStamp(root, "s1", plan);
  const first = fs.readFileSync(stampPath(root, "s1"), "utf8");
  writeStamp(root, "s1", plan);
  expect(fs.readFileSync(stampPath(root, "s1"), "utf8")).toBe(first);
  expect(fs.readdirSync(path.dirname(stampPath(root, "s1")))).toStrictEqual(["strategy.json"]);
});

it("stamps a plan typed with ./ or .. as its canonical path", () => {
  const root = realDir("strategy-");
  const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("spawn-fast"));
  writeStamp(root, "s1", `${root}/./.repo/tmp/../plans/4-x-20261107T181901Z.md`);
  expect(JSON.parse(fs.readFileSync(stampPath(root, "s1"), "utf8"))).toStrictEqual({ plan });
});

it("stamps through a symlinked spelling of the root and finds the plan", () => {
  const root = realDir("strategy-");
  const plan = writePlan(root, "4-x-20261107T181901Z.md", planFm("spawn-fast"));
  const alias = aliasOf(root);
  writeStamp(alias, "s1", path.join(alias, ".repo", "plans", "4-x-20261107T181901Z.md"));
  expect(JSON.parse(fs.readFileSync(stampPath(root, "s1"), "utf8"))).toStrictEqual({ plan });
  expect(activeReview(alias, "s1")).toStrictEqual({ plan, serial: 4, strategy: "spawn-fast" });
  expect(activeReview(root, "s1")?.plan).toBe(plan);
});

it("enforces the harnesses whose child payload carries a marker: claude (and Grok through it) and codex", () => {
  expect([...ENFORCED_HARNESSES].toSorted()).toStrictEqual(["claude", "codex"]);
});

it("tells an item that has a strategy from a fast plan or fast roadmap", () => {
  expect(hasStrategy({ kind: "plan", serial: 1, strategy: "free" })).toBe(true);
  expect(hasStrategy({ kind: "roadmap", serial: 1, strategy: "spawn-deep" })).toBe(true);
  expect(hasStrategy({ kind: "fast-plan", serial: 1 })).toBe(false);
  expect(hasStrategy({ kind: "fast-roadmap", serial: 1 })).toBe(false);
  expect(kindHasStrategy("plan")).toBe(true);
  expect(kindHasStrategy("fast-roadmap")).toBe(false);
});
