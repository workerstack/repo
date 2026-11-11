import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { VALID_IMPL } from "./__fixtures__/persist-bodies.ts";
import { describeSerialLimits, describeSourceAndRefusals, saveAtRepoRoot } from "./__fixtures__/persist-save-kit.ts";
import { IMPLEMENTATION_DIR } from "./persist-implementation.constants.ts";
import { persistImplementation } from "./persist-implementation.ts";

const { tempDir } = useTempDirs("persist-impl-s-");

function tmpWs(): string {
  return fs.realpathSync(tempDir());
}

const CREATED = "2026-08-26T14:30:00Z";
const STAMP = "20260826T143000Z";
const withoutName = VALID_IMPL.replace("IMPL_NAME: add tmp ignore\n", "");

describe("persistImplementation naming", () => {
  it("names the file after the first H1 when there is no IMPL_NAME", () => {
    const r = persistImplementation({ content: withoutName, created: CREATED, workspaceRoot: tmpWs() });
    expect(r.filename).toBe(`1-add-tmp-ignore-${STAMP}.md`);
    expect(r.content).toContain('source: "add-tmp-ignore"');
  });

  it("reads the H1 past a leading frontmatter block", () => {
    const r = persistImplementation({
      content: `---\nold: 1\n---\n${withoutName}`,
      created: CREATED,
      workspaceRoot: tmpWs(),
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("add-tmp-ignore");
  });

  it("falls back to the Done text for the source when nothing names the journal", () => {
    const content = withoutName
      .replace("# add-tmp-ignore\n\n", "")
      .replace("## Done\n(none)", "## Done\n- wrote\n- the ignore");
    const r = persistImplementation({ content, created: CREATED, workspaceRoot: tmpWs() });
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("unnamed");
    expect(r.content).toContain('source: "- wrote - the ignore"');
  });
});

const KIT = {
  body: VALID_IMPL,
  created: CREATED,
  dir: IMPLEMENTATION_DIR,
  label: "persistImplementation",
  save: persistImplementation,
  slug: "add-tmp-ignore",
  tmpWs,
};
describeSourceAndRefusals(KIT);
describeSerialLimits(KIT);

describe("persistImplementation root", () => {
  it("saves under the repo root of the working directory when no workspace is given", () => {
    saveAtRepoRoot(KIT);
    expect(persistImplementation().ok).toBe(false);
  });
});
