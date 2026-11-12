import { afterEach, describe, expect, it } from "vitest";

import { removePlanted, tempDir, write } from "./__fixtures__/planted-repo.ts";
import { checkChangelog } from "./check-changelog.ts";

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
    const lines = checkChangelog(root({ "CHANGELOG.md": BAD, "package.json": { name: "app" } }));
    expect(lines).toStrictEqual([
      'CHANGELOG.md:5: "### Improved" is not a section; use Added, Changed, Deprecated, Removed, Fixed or Security',
      'CHANGELOG.md:9: "## [0.2.0]" needs a date; write ## [0.2.0] - YYYY-MM-DD',
    ]);
  });

  it("passes a public root with a good changelog", () => {
    expect(checkChangelog(root({ "CHANGELOG.md": GOOD, "package.json": { name: "app" } }))).toStrictEqual([]);
  });

  it("names a missing CHANGELOG.md in a public root", () => {
    expect(checkChangelog(root({ "package.json": { name: "app" } }))).toStrictEqual([
      "CHANGELOG.md is missing; add one in the Keep a Changelog format",
    ]);
  });

  it("checks nothing in a private root, or one without a readable manifest", () => {
    expect(checkChangelog(root({ "CHANGELOG.md": BAD, "package.json": { name: "app", private: true } }))).toStrictEqual(
      [],
    );
    expect(checkChangelog(root({ "CHANGELOG.md": BAD }))).toStrictEqual([]);
    expect(checkChangelog(root({ "CHANGELOG.md": BAD, "package.json": "[" }))).toStrictEqual([]);
  });
});
