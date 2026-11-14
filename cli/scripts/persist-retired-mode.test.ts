import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { DRAFT_ROADMAP, VALID_PLAN, savedOk } from "./__fixtures__/persist-bodies.ts";
import { read, update as updatePlan, useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { CREATED, savedRoadmap, update as updateRoadmap } from "./__fixtures__/persist-roadmap-kit.ts";
import { persistPlan } from "./persist-plan.ts";
import { persistRoadmap } from "./persist-roadmap.ts";

const RETIRED = "mode: is now approval:; use approval: ask|away";
const BARE = "mode: away\n";

const planWs = useTmpWs();
const { tempDir: roadmapWs } = useTempDirs("persist-retired-mode-");

/** `text` with a `mode:` line added after its `strategy:` line. */
function afterStrategy(text: string): string {
  return text.replace(/^strategy:.*$/m, (line) => `${line}\nmode: away`);
}

/** One save path: its body, how it creates, and how it saves a new text over a saved file. */
type Kind = {
  name: string;
  draft: string;
  workspace: () => string;
  create: (content: string, ws: string) => { ok: boolean; errors?: string[] };
  seed: (ws: string) => string;
  update: (ws: string, abs: string, content: string) => { ok: boolean; errors?: string[] };
};

const KINDS: Kind[] = [
  {
    create: (content, ws) => persistPlan({ content, created: CREATED, workspaceRoot: ws }),
    draft: VALID_PLAN,
    name: "plan",
    seed: (ws) =>
      path.join(ws, savedOk(persistPlan({ content: VALID_PLAN, created: CREATED, workspaceRoot: ws })).path),
    update: updatePlan,
    workspace: planWs,
  },
  {
    create: (content, ws) => persistRoadmap({ content, created: CREATED, workspaceRoot: ws }),
    draft: DRAFT_ROADMAP,
    name: "roadmap",
    seed: (ws) => savedRoadmap(ws),
    update: updateRoadmap,
    workspace: roadmapWs,
  },
];

describe.each(KINDS)("a $name save with the retired mode key", (kind) => {
  it("denies it as a bare line above the name line and after strategy, on create", () => {
    for (const content of [`${BARE}${kind.draft}`, afterStrategy(kind.draft)]) {
      const r = kind.create(content, kind.workspace());

      expect(r.ok).toBe(false);
      expect(r.errors).toContain(RETIRED);
    }
  });

  it("denies it as a bare line, a body line and a full frontmatter key on update, and saves nothing", () => {
    const ws = kind.workspace();
    const abs = kind.seed(ws);
    const before = read(abs);

    for (const content of [`${BARE}${kind.draft}`, afterStrategy(kind.draft), afterStrategy(before)]) {
      const r = kind.update(ws, abs, content);

      expect(r.ok).toBe(false);
      expect(r.errors).toContain(RETIRED);
    }

    expect(read(abs)).toBe(before);
  });
});
