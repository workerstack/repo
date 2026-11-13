import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { BODY, CREATED, SENT, saveRoadmap, savedRoadmap } from "./__fixtures__/persist-fast-roadmap-kit.ts";
import { read, useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { persistFastRoadmap } from "./persist-fast-roadmap.ts";
import { persistPlan } from "./persist-plan.ts";

const tmpWs = useTmpWs("persist-fast-roadmap-");

describe("fast roadmap save", () => {
  it("saves the Usage roadmap under roadmaps-fast with only the frontmatter keys it needs", () => {
    const { abs, r } = savedRoadmap(tmpWs());
    const head = `---\nserial: 1\nname: tidy-ignores\nstatus: draft\ncreated: ${CREATED}\nsource: "tidy ignores"\n---`;
    expect(r.path).toBe(".repo/roadmaps-fast/1-tidy-ignores-20261113T040000Z.md");
    expect(r.serial).toBe(1);
    expect(read(abs)).toBe(r.content);
    expect(r.content.startsWith(`${head}\n\n# tidy-ignores`)).toBe(true);
    expect(r.content).not.toMatch(/^(reviews|strategy|commit):/m);
    expect(r.content).not.toContain("FAST_ROADMAP_NAME");
  });

  it("names the roadmap from its heading when no name line is sent", () => {
    const r = saveRoadmap(BODY.replace("# anything", "# from heading"), tmpWs());
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("from-heading");
    expect(r.content).toContain('source: "1 [ ] ignore tmp: add .tmp/');
    const named = persistFastRoadmap({ content: SENT, source: "asked", workspaceRoot: tmpWs() });
    expect(named.content).toContain('source: "asked"');
  });

  it("reads the name line only above the first heading and tidies blank lines", () => {
    const r = saveRoadmap(`\n\nFAST_ROADMAP_NAME: first\n\n\n${BODY}`, tmpWs());
    expect(r.slug).toBe("first");
    expect(saveRoadmap("FAST_ROADMAP_NAME: only\n", tmpWs()).ok).toBe(false);
  });

  it("denies an unclosed fence", () => {
    expect(saveRoadmap(`${SENT}\n\`\`\`\n`, tmpWs()).error).toMatch(/unclosed code fence/);
  });
});

describe("fast roadmap serials", () => {
  it("counts serials in roadmaps-fast only", () => {
    const ws = tmpWs();
    expect(persistPlan({ content: VALID_PLAN, created: CREATED, workspaceRoot: ws }).ok).toBe(true);
    expect(saveRoadmap(SENT, ws).serial).toBe(1);
    expect(saveRoadmap(SENT.replace("tidy ignores", "second one"), ws).serial).toBe(2);
    expect(fs.readdirSync(path.join(ws, ".repo/roadmaps-fast"))).toHaveLength(2);
  });
});
