import { expect, it } from "vitest";
import {
  ATTACK_UPSTREAM,
  EXPLAIN_UPSTREAM,
  GUARD_UPSTREAM,
  LEVER_UPSTREAM,
  NEVER_UPSTREAM,
  PROVE_UPSTREAM,
} from "./sync-pstack-principle-fixtures.ts";
import { adaptOk, principle } from "./sync-pstack-fixtures.ts";
import { PRINCIPLE_SKILL_NAMES, PSTACK_SKILLS } from "./sync-pstack-skills.constants.ts";

it("adaptFile ports a principle skill slash-only and rewrites principle refs", () => {
  const out = adaptOk(principle("principle-attack-the-premise"), "SKILL.md", ATTACK_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toEqual([]);
  expect(out.text).toContain("Use for /principle-attack-the-premise.");
  expect(out.text).toContain("Slash `/principle-attack-the-premise` only. Not a session flag.");
  expect(out.text).toContain("`/principle-build-the-lever`");
  expect(out.text).toContain("`/principle-prove-it-works`");
  expect(out.text).not.toContain("disable-model-invocation");
  expect(out.text).not.toContain("../principle-build-the-lever/SKILL.md");
  expect(out.text).not.toContain("**prove-it-works** principle skill");
});

it("adaptFile inlines explain-the-number benchmark-checklist", () => {
  const out = adaptOk(principle("principle-explain-the-number"), "SKILL.md", EXPLAIN_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toEqual([]);
  for (const phrase of ["name the limiter", "check tuning", "count errors", "repeat", "relevance", "work happened"]) {
    expect(out.text).toContain(phrase);
  }
  expect(out.text).toContain("`/principle-prove-it-works`");
  expect(out.text).not.toContain("benchmark-checklist");
});

it("adaptFile drops prove-it-works show-me-your-work skill", () => {
  const out = adaptOk(principle("principle-prove-it-works"), "SKILL.md", PROVE_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toEqual([]);
  expect(out.text).toContain("Keep the artifact visible for the human.");
  expect(out.text).not.toContain("show-me-your-work");
});

it("adaptFile rewrites build-the-lever subagent wording", () => {
  const lever = adaptOk(principle("principle-build-the-lever"), "SKILL.md", LEVER_UPSTREAM);
  expect(lever.ok).toBe(true);
  expect(lever.misses).toEqual([]);
  expect(lever.text).toMatch(/later turns/);
  expect(lever.text).toMatch(/child runs/);
  expect(lever.text.toLowerCase()).not.toContain("subagent");
});

it("adaptFile rewrites guard-the-context-window subagent wording", () => {
  const guard = adaptOk(principle("principle-guard-the-context-window"), "SKILL.md", GUARD_UPSTREAM);
  expect(guard.ok).toBe(true);
  expect(guard.misses).toEqual([]);
  expect(guard.text).toContain("job");
  expect(guard.text).toContain(".tmp/repo/");
  expect(guard.text.toLowerCase()).not.toContain("subagent");
});

it("adaptFile adapts never-block-on-the-human to repo plan-first", () => {
  const out = adaptOk(principle("principle-never-block-on-the-human"), "SKILL.md", NEVER_UPSTREAM);
  expect(out.ok).toBe(true);
  expect(out.misses).toEqual([]);
  for (const phrase of ["plan approval", "real blockers", "irreversible", "already that approval"]) {
    expect(out.text).toContain(phrase);
  }
  expect(out.text).toContain("Don't ask preference on reversible execution");
});

it("PSTACK_SKILLS lists all 24 principle skills as slash-only SKILL.md", () => {
  const principles = PSTACK_SKILLS.filter((s) => s.name.startsWith("principle-"));
  expect(principles.map((s) => s.name)).toEqual(PRINCIPLE_SKILL_NAMES);
  expect(principles).toHaveLength(24);
  for (const s of principles) {
    expect(s).toEqual({ name: s.name, files: ["SKILL.md"], slash: true });
  }
});
