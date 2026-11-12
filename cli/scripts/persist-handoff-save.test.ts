import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { VALID_HANDOFF } from "./__fixtures__/persist-bodies.ts";
import { describeSerialLimits, describeSourceAndRefusals, saveAtRepoRoot } from "./__fixtures__/persist-save-kit.ts";
import { HANDOFF_DIR } from "./persist-handoff.constants.ts";
import { persistHandoff } from "./persist-handoff.ts";

const { tempDir } = useTempDirs("persist-handoff-s-");

function tmpWs(): string {
  return fs.realpathSync(tempDir());
}

const CREATED = "2026-08-27T14:30:00Z";
const STAMP = "20260827T143000Z";
const withoutName = VALID_HANDOFF.replace("HANDOFF_NAME: sync skills to hosts\n\n", "");

describe("persistHandoff naming", () => {
  it("names the file after the first H1 when there is no HANDOFF_NAME", () => {
    const r = persistHandoff({ content: withoutName, created: CREATED, workspaceRoot: tmpWs() });
    expect(r.filename).toBe(`1-sync-skills-to-hosts-${STAMP}.md`);
    expect(r.content).toContain('source: "sync-skills-to-hosts"');
  });

  it("reads the H1 past a leading frontmatter block", () => {
    const r = persistHandoff({
      content: `---\nold: 1\n---\n${withoutName}`,
      created: CREATED,
      workspaceRoot: tmpWs(),
    });

    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("sync-skills-to-hosts");
  });

  it("falls back to the Goal text for the source when nothing names the handoff", () => {
    const content = withoutName.replace("# sync-skills-to-hosts\n\n", "");
    const r = persistHandoff({ content, created: CREATED, workspaceRoot: tmpWs() });
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("unnamed");
    expect(r.content).toContain(
      'source: "Ship /handoff as a skill on every host. Claude links resolve to the source."',
    );
  });
});

const KIT = {
  body: VALID_HANDOFF,
  created: CREATED,
  dir: HANDOFF_DIR,
  label: "persistHandoff",
  save: persistHandoff,
  slug: "sync-skills-to-hosts",
  tmpWs,
};

describeSourceAndRefusals(KIT);

describeSerialLimits(KIT);

describe("persistHandoff empty body", () => {
  it("refuses an empty body with the reasons it fails", () => {
    const r = persistHandoff({ content: "", workspaceRoot: tmpWs() });
    expect(r.ok).toBe(false);
    expect(r.errors).toStrictEqual(expect.arrayContaining(["goal", "heading order", "State empty"]));
  });
});

describe("persistHandoff root", () => {
  it("saves under the repo root of the working directory when no workspace is given", () => {
    saveAtRepoRoot(KIT);
    expect(persistHandoff().ok).toBe(false);
  });
});
