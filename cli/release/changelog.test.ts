import { describe, expect, it } from "vitest";

import { changelogFormatProblems, hasUnreleased, insertEntry, stampChangelog } from "./changelog.ts";

const HEAD = "# Changelog\n\nAll notable changes.\n\n";

describe("changelogFormatProblems headings", () => {
  it("passes a changelog in the Keep a Changelog format", () => {
    const text =
      `${HEAD}## [Unreleased]\n\n### Added\n\n- x\n\n## [0.2.0] - 2026-11-01\n\n### Fixed\n` +
      `\n- y\n\n## [0.1.0] - 2026-10-01\n\n### Added\n\n- z\n`;

    expect(changelogFormatProblems(text)).toStrictEqual([]);
  });

  it("says a missing file is missing", () => {
    expect(changelogFormatProblems(null)).toStrictEqual([
      "CHANGELOG.md is missing; add one in the Keep a Changelog format",
    ]);
  });

  it("asks for an Unreleased section", () => {
    expect(changelogFormatProblems(`${HEAD}## [0.1.0] - 2026-10-01\n`)).toStrictEqual([
      "CHANGELOG.md has no ## [Unreleased] section; add it above the newest version",
    ]);
  });

  it("wants a date on every version", () => {
    const text = `${HEAD}## [Unreleased]\n\n## [0.2.0]\n\n### Added\n\n- x\n`;
    expect(changelogFormatProblems(text)).toStrictEqual([
      'CHANGELOG.md:7: "## [0.2.0]" needs a date; write ## [0.2.0] - YYYY-MM-DD',
    ]);
  });

  it("accepts only the six Keep a Changelog sections", () => {
    const text = `${HEAD}## [Unreleased]\n\n### Improved\n\n- x\n\n### Security\n\n- y\n`;
    expect(changelogFormatProblems(text)).toStrictEqual([
      'CHANGELOG.md:7: "### Improved" is not a section; use Added, Changed, Deprecated, Removed, Fixed or Security',
    ]);
  });
});

describe("changelogFormatProblems order", () => {
  it("lists versions newest first, a prerelease below its release", () => {
    const text =
      `${HEAD}## [Unreleased]\n\n## [0.2.0] - 2026-11-01\n` +
      `\n## [0.3.0] - 2026-11-02\n\n## [0.3.0-rc.0] - 2026-11-01\n`;

    expect(changelogFormatProblems(text)).toStrictEqual([
      "CHANGELOG.md:9: 0.3.0 is below 0.2.0; list versions newest first",
    ]);

    const ok =
      `${HEAD}## [Unreleased]\n\n## [1.0.0] - 2026-11-02\n` +
      `\n## [1.0.0-rc.1] - 2026-11-01\n\n## [1.0.0-rc.0] - 2026-10-30\n`;

    expect(changelogFormatProblems(ok)).toStrictEqual([]);
  });
});

describe("changelogFormatProblems prereleases", () => {
  it("puts a release above its prereleases and orders other prerelease ids by name", () => {
    const pre = `${HEAD}## [Unreleased]\n\n## [1.0.0-rc.0] - 2026-11-01\n\n## [1.0.0] - 2026-11-02\n`;
    expect(changelogFormatProblems(pre)).toStrictEqual([
      "CHANGELOG.md:9: 1.0.0 is below 1.0.0-rc.0; list versions newest first",
    ]);
    const ids = `${HEAD}## [Unreleased]\n\n## [1.0.0-beta.0] - 2026-11-01\n\n## [1.0.0-rc.0] - 2026-11-02\n`;
    expect(changelogFormatProblems(ids)).toStrictEqual([
      "CHANGELOG.md:9: 1.0.0-rc.0 is below 1.0.0-beta.0; list versions newest first",
    ]);
  });

  it("names a version listed twice", () => {
    const text = `${HEAD}## [Unreleased]\n\n## [0.2.0] - 2026-11-01\n\n## [0.2.0] - 2026-11-01\n`;
    expect(changelogFormatProblems(text)).toStrictEqual(["CHANGELOG.md:9: 0.2.0 is listed twice; merge the sections"]);
  });

  it("asks for a version heading where a section has another name", () => {
    expect(changelogFormatProblems(`${HEAD}## [Unreleased]\n\n## Notes\n`)).toStrictEqual([
      'CHANGELOG.md:7: "## Notes" is not a version; write ## [x.y.z] - YYYY-MM-DD',
    ]);
  });

  it("does not read headings inside a code fence", () => {
    const text = `${HEAD}## [Unreleased]\n\n\`\`\`md\n### Improved\n## [9.9.9]\n\`\`\`\n`;
    expect(changelogFormatProblems(text)).toStrictEqual([]);
  });
});

describe("hasUnreleased", () => {
  it("is true when Unreleased holds any text under a heading", () => {
    expect(hasUnreleased(`${HEAD}## [Unreleased]\n\n### Added\n\n- x\n\n## [0.1.0] - 2026-10-01\n`)).toBe(true);
  });

  it("is false for an empty Unreleased, a heading with no entries and a missing section", () => {
    expect(hasUnreleased(`${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-10-01\n\n- old\n`)).toBe(false);
    expect(hasUnreleased(`${HEAD}## [Unreleased]\n\n### Added\n\n`)).toBe(false);
    expect(hasUnreleased(HEAD)).toBe(false);
  });
});

const UNRELEASED = "## [Unreleased]\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n\n";

describe("stampChangelog", () => {
  it("moves the Unreleased entries under the new version, leaving an empty Unreleased", () => {
    const text = `${HEAD}${UNRELEASED}## [0.1.0] - 2026-10-01\n\n### Added\n\n- old\n`;
    expect(stampChangelog(text, "0.1.1", "2026-11-09")).toBe(
      `${HEAD}## [Unreleased]\n\n## [0.1.1] - 2026-11-09\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n` +
        `\n## [0.1.0] - 2026-10-01\n\n### Added\n\n- old\n`,
    );
  });

  it("works on a changelog with no older version", () => {
    expect(stampChangelog(`${HEAD}${UNRELEASED}`, "0.1.0", "2026-11-09")).toBe(
      `${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-11-09\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n`,
    );
  });

  it("folds Unreleased into an existing section by heading, in Keep a Changelog order", () => {
    const text =
      `${HEAD}## [Unreleased]\n\n### Security\n\n- s\n\n### Added\n\n- new\n\n## [0.1.1] - 2026-11-08\n` +
      `\n### Fixed\n\n- f\n\n### Added\n\n- old\n\n## [0.1.0] - 2026-10-01\n`;

    expect(stampChangelog(text, "0.1.1", "2026-11-09")).toBe(
      `${HEAD}## [Unreleased]\n\n## [0.1.1] - 2026-11-08\n\n### Added\n\n- new\n- old\n\n### Fixed\n` +
        `\n- f\n\n### Security\n\n- s\n\n## [0.1.0] - 2026-10-01\n`,
    );
  });
});

const PRERELEASES =
  `${HEAD}## [Unreleased]\n\n### Fixed\n\n- last\n\n## [1.1.0-rc.1] - 2026-11-02\n\n### Fixed\n` +
  `\n- two\n\n## [1.1.0-rc.0] - 2026-11-01\n\n### Added\n\n- one\n\n## [1.0.0] - 2026-10-01\n` +
  `\n### Added\n\n- base\n`;

describe("stampChangelog edge cases", () => {
  it("changes nothing in the section when Unreleased is empty", () => {
    const text = `${HEAD}## [Unreleased]\n\n## [0.1.1] - 2026-11-08\n\n### Added\n\n- old\n`;
    expect(stampChangelog(text, "0.1.1", "2026-11-09")).toBe(text);
  });

  it("folds the prerelease sections of the same base into the release", () => {
    expect(stampChangelog(PRERELEASES, "1.1.0", "2026-11-09")).toBe(
      `${HEAD}## [Unreleased]\n\n## [1.1.0] - 2026-11-09\n\n### Added\n\n- one\n\n### Fixed\n\n- last\n` +
        `- two\n\n## [1.0.0] - 2026-10-01\n\n### Added\n\n- base\n`,
    );
  });

  it("keeps text outside any ### heading and an unknown heading after the known ones", () => {
    const text = `${HEAD}## [Unreleased]\n\nLoose note.\n\n### Extras\n\n- e\n\n### Added\n\n- a\n`;
    expect(stampChangelog(text, "0.1.0", "2026-11-09")).toBe(
      `${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-11-09\n\nLoose note.\n\n### Added\n\n- a\n\n### Extras\n\n- e\n`,
    );
  });

  it("keeps a section that names no version where it was", () => {
    const text = `${HEAD}## [Unreleased]\n\n### Added\n\n- a\n\n## Notes\n\nSee below.\n`;
    expect(stampChangelog(text, "0.1.0", "2026-11-09")).toBe(
      `${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-11-09\n\n### Added\n\n- a\n\n## Notes\n\nSee below.\n`,
    );
  });

  it("adds Unreleased when the file has none", () => {
    expect(stampChangelog(HEAD, "0.1.0", "2026-11-09")).toBe(`${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-11-09\n`);
  });
});

/** The text `insertEntry` gives back for a changelog with an Unreleased section. */
function added(text: string, section: string, entry: string): string {
  return insertEntry(text, section, entry)?.text ?? "";
}

const OLDER = "## [0.1.0] - 2026-10-01\n\n### Added\n\n- old\n";
const BASE = `${HEAD}## [Unreleased]\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n\n${OLDER}`;

describe("changelogFormatProblems file name", () => {
  it("names the file it was given", () => {
    expect(changelogFormatProblems(null, "lib/CHANGELOG.md")).toStrictEqual([
      "lib/CHANGELOG.md is missing; add one in the Keep a Changelog format",
    ]);
    expect(changelogFormatProblems(`${HEAD}${OLDER}`, "lib/CHANGELOG.md")).toStrictEqual([
      "lib/CHANGELOG.md has no ## [Unreleased] section; add it above the newest version",
    ]);
    expect(changelogFormatProblems(`${HEAD}## [Unreleased]\n\n## [0.1.0]\n`, "lib/CHANGELOG.md")).toStrictEqual([
      'lib/CHANGELOG.md:7: "## [0.1.0]" needs a date; write ## [0.1.0] - YYYY-MM-DD',
    ]);
  });
});

describe("insertEntry", () => {
  it("adds the bullet after the last line of its group and changes nothing else", () => {
    expect(added(BASE, "Added", "b")).toBe(BASE.replace("- a\n", "- a\n- b\n"));
    expect(added(BASE, "Fixed", "g")).toBe(BASE.replace("- f\n", "- f\n- g\n"));
    expect(added(BASE, "Added", "- b")).toBe(added(BASE, "Added", "b"));
  });

  it("puts a new group in Keep a Changelog order with one blank line around its heading", () => {
    expect(added(BASE, "Changed", "c")).toBe(BASE.replace("### Fixed", "### Changed\n\n- c\n\n### Fixed"));
    expect(added(BASE, "Security", "s")).toBe(BASE.replace("- f\n", "- f\n\n### Security\n\n- s\n"));
  });
});

describe("insertEntry in a new place", () => {
  it("puts a first group above a later one", () => {
    const text = `${HEAD}## [Unreleased]\n\n### Fixed\n\n- f\n\n${OLDER}`;
    expect(added(text, "Added", "a")).toBe(
      `${HEAD}## [Unreleased]\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n\n${OLDER}`,
    );
  });

  it("fills an Unreleased with no group, followed by a version or by the end of the file", () => {
    expect(added(`${HEAD}## [Unreleased]\n\n${OLDER}`, "Added", "a")).toBe(
      `${HEAD}## [Unreleased]\n\n### Added\n\n- a\n\n${OLDER}`,
    );
    expect(added(`${HEAD}## [Unreleased]\n`, "Added", "a")).toBe(`${HEAD}## [Unreleased]\n\n### Added\n\n- a\n`);
  });

  it("fills a heading that holds no entry yet", () => {
    const text = `${HEAD}## [Unreleased]\n\n### Added\n\n### Fixed\n\n- f\n`;
    expect(added(text, "Added", "a")).toBe(`${HEAD}## [Unreleased]\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n`);
  });

  it("keeps CRLF line endings, and a missing final newline", () => {
    const crlf = BASE.replaceAll("\n", "\r\n");
    expect(added(crlf, "Added", "b")).toBe(added(BASE, "Added", "b").replaceAll("\n", "\r\n"));
    expect(added(BASE.trimEnd(), "Added", "b")).toBe(added(BASE, "Added", "b").trimEnd());
  });
});

describe("insertEntry leaves alone", () => {
  it("a ### inside a code fence, which is no group", () => {
    const text = `${HEAD}## [Unreleased]\n\n\`\`\`md\n### Added\n\`\`\`\n\n### Fixed\n\n- f\n`;
    expect(added(text, "Added", "a")).toBe(
      `${HEAD}## [Unreleased]\n\n\`\`\`md\n### Added\n\`\`\`\n\n### Added\n\n- a\n\n### Fixed\n\n- f\n`,
    );
  });

  it("gives nothing for a changelog with no Unreleased", () => {
    expect(insertEntry(`${HEAD}${OLDER}`, "Added", "a")).toBeNull();
  });
});
