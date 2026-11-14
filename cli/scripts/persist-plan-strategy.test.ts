import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VALID_PLAN, savedOk } from "./__fixtures__/persist-bodies.ts";
import { read, update, useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { persistPlan } from "./persist-plan.ts";
import type { Strategy } from "./strategy.types.ts";

const tmpWs = useTmpWs();

const CREATED = "2026-08-26T14:30:00Z";
const NO_KEY = "strategy: free|spawn-fast|spawn-deep";

/** `body` with a `strategy:` line after its name line: the update path still reads one. */
function withStrategy(body: string, value: string) {
  return body.replace(/^PLAN_NAME:.*$/m, (l) => `${l}\nstrategy: ${value}`);
}

function save(strategy: Strategy, content = VALID_PLAN, ws = tmpWs()) {
  return persistPlan({ content, created: CREATED, strategy, workspaceRoot: ws });
}

describe("plan strategy on a new save", () => {
  it("writes the strategy it is given into the frontmatter after commit and none in the body", () => {
    const ws = tmpWs();
    const r = save("spawn-deep", `commit: feat: add the thing\n${VALID_PLAN}`, ws);
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, savedOk(r).path));
    const [head, ...body] = text.split("\n---\n");
    expect(head).toMatch(/commit: feat: add the thing\nstrategy: spawn-deep$/);
    expect(body.join("\n---\n")).not.toMatch(/^strategy:/m);
    expect(validatePlan(savedOk(r).filename, text)).toStrictEqual([]);
  });

  it("leaves a strategy line inside a code fence alone", () => {
    const fenced = VALID_PLAN.replace("## Context", "```console\nstrategy: spawn-fast\n```\n\n## Context");
    const ws = tmpWs();
    const r = save("free", fenced, ws);
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, savedOk(r).path));
    expect(text).toMatch(/^strategy: free$/m);
    expect(text).toMatch(/^```console\nstrategy: spawn-fast\n```$/m);
  });

  it.each(["free", "spawn-fast", "spawn-deep"] as const)("takes %s as given", (strategy) => {
    const ws = tmpWs();
    const r = save(strategy, VALID_PLAN, ws);
    expect(r.ok, r.error).toBe(true);
    expect(read(path.join(ws, savedOk(r).path))).toMatch(new RegExp(`^source: .*\\nstrategy: ${strategy}\\n---$`, "m"));
  });
});

describe("plan strategy kept", () => {
  it("keeps the saved key on an update whose frontmatter omits it", () => {
    const ws = tmpWs();
    const r = save("spawn-fast", VALID_PLAN, ws);
    const abs = path.join(ws, savedOk(r).path);
    const u = update(ws, abs, read(abs).replace(/^strategy:.*\n/m, ""));
    expect(u.ok, u.error).toBe(true);
    expect(u.content).toMatch(/^strategy: spawn-fast$/m);
  });
});

describe("plan strategy and advice kept beside approval", () => {
  it("puts the kept strategy and advice before approval when a full frontmatter omits them", () => {
    const ws = tmpWs();
    const named = VALID_PLAN.replace(/^PLAN_NAME:.*$/m, (l) => `${l}\nadvice: free because small\napproval: away`);
    const abs = path.join(ws, savedOk(save("spawn-fast", named, ws)).path);
    const u = update(ws, abs, read(abs).replaceAll(/^(?:strategy|advice):.*\n/gm, ""));
    expect(u.ok, u.error).toBe(true);
    expect(u.content).toMatch(/^strategy: spawn-fast\nadvice: free because small\napproval: away\n---$/m);
  });

  it("gives the same refusal as before for a frontmatter that is not closed", () => {
    const ws = tmpWs();
    const abs = path.join(ws, savedOk(save("free", VALID_PLAN, ws)).path);
    const unclosed = read(abs).replace("\n---\n", "\n");
    const u = update(ws, abs, unclosed);
    expect(u.ok).toBe(false);
    expect(u.errors).toContain("unterminated frontmatter");
  });
});

describe("plan strategy updates", () => {
  it("keeps the key on a body-only update and takes a new one from a body line", () => {
    const ws = tmpWs();
    const r = save("spawn-fast", VALID_PLAN, ws);
    const abs = path.join(ws, savedOk(r).path);
    const kept = update(ws, abs, VALID_PLAN.replace("Existing ignore entries stay.", "Other entries stay."));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: spawn-fast$/m);
    const changed = update(ws, abs, withStrategy(VALID_PLAN, "spawn-deep"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: spawn-deep$/m);
    expect(read(abs).match(/^strategy:/gm)).toHaveLength(1);
    const bad = update(ws, abs, withStrategy(VALID_PLAN, "review-medium"));
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain(NO_KEY);
  });

  it("adds the key to a saved head that lacks it only from a body line", () => {
    const ws = tmpWs();
    const r = save("free", VALID_PLAN, ws);
    const abs = path.join(ws, savedOk(r).path);
    fs.writeFileSync(abs, read(abs).replace(/^strategy:.*\n/m, ""));
    expect(update(ws, abs, VALID_PLAN).errors).toContain(NO_KEY);
    const ok = update(ws, abs, withStrategy(VALID_PLAN, "spawn-fast"));
    expect(ok.ok, ok.error).toBe(true);
    expect(read(abs)).toMatch(/^source: .*\nstrategy: spawn-fast\n---$/m);
  });
});
