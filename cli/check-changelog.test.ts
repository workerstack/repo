import { afterEach, describe, expect, it } from "vitest";
import { checkChangelog } from "./check-changelog.ts";
import { removePlanted, tempDir, write } from "./fixtures/planted-repo.ts";

afterEach(removePlanted);

const BAD = "# Changelog\n\n## [Unreleased]\n\n### Improved\n\n- x\n\n## [0.2.0]\n";
const GOOD = "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [0.2.0] - 2026-11-01\n";

function root(files: Record<string, unknown>): string {
  const dir = tempDir();
  write(dir, files);
  return dir;
}

describe("checkChangelog", () => {
  it("holds a public root's CHANGELOG.md to Keep a Changelog, one line per problem", () => {
    const lines = checkChangelog(root({ "package.json": { name: "app" }, "CHANGELOG.md": BAD }));
    expect(lines).toEqual([
      'CHANGELOG.md:5: "### Improved" is not a section; use Added, Changed, Deprecated, Removed, Fixed or Security',
      'CHANGELOG.md:9: "## [0.2.0]" needs a date; write ## [0.2.0] - YYYY-MM-DD',
    ]);
  });

  it("passes a public root with a good changelog", () => {
    expect(checkChangelog(root({ "package.json": { name: "app" }, "CHANGELOG.md": GOOD }))).toEqual([]);
  });

  it("names a missing CHANGELOG.md in a public root", () => {
    expect(checkChangelog(root({ "package.json": { name: "app" } }))).toEqual([
      "CHANGELOG.md is missing; add one in the Keep a Changelog format",
    ]);
  });

  it("checks nothing in a private root, or one without a readable manifest", () => {
    expect(checkChangelog(root({ "package.json": { name: "app", private: true }, "CHANGELOG.md": BAD }))).toEqual([]);
    expect(checkChangelog(root({ "CHANGELOG.md": BAD }))).toEqual([]);
    expect(checkChangelog(root({ "package.json": "[", "CHANGELOG.md": BAD }))).toEqual([]);
  });
});
