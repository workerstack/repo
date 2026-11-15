import { describe, expect, it } from "vitest";

import { checkCommitMessage } from "./commit-msg.ts";

const ADA = "Ada Lovelace <ada@example.com>";
const CLAUDE = "Claude <noreply@anthropic.com>";

/** The problems with `message` in a repo that lists Ada and Claude, `changedLines` big. */
function check(message: string, changedLines = 0) {
  return checkCommitMessage(message, {
    changedLines,
    coAuthors: [ADA, CLAUDE],
    maxChangedLines: 1000,
    stagedFiles: [],
  });
}

function unlisted(identity: string): string {
  return `the co-author "${identity}" is not listed; add it to commit.coAuthors in repo.config.ts, or remove the line`;
}

function moved(line: string): string {
  return `move "${line}" to the last paragraph, which holds only co-author lines`;
}

describe("co-author lines: who passes", () => {
  it("passes a listed co-author beside the subject alone, whatever the key's case", () => {
    expect(check(`chore: tidy x\n\nCo-authored-by: ${ADA}\n`)).toStrictEqual([]);
    expect(check(`chore: tidy x\n\nCo-Authored-By: ${ADA}\n`)).toStrictEqual([]);
    expect(check(`chore: tidy x\n\nco-authored-by: ${ADA}\n`)).toStrictEqual([]);
  });

  it("refuses a co-author the config does not list, naming the fix", () => {
    expect(check("chore: tidy x\n\nCo-authored-by: Eve <eve@x.io>\n")).toStrictEqual([unlisted("Eve <eve@x.io>")]);
    expect(check(`chore: tidy x\n\nCo-authored-by: ${ADA}\nCo-authored-by: Ada <ada@example.com>\n`)).toStrictEqual([
      unlisted("Ada <ada@example.com>"),
    ]);
  });

  it("refuses every co-author when the facts list none", () => {
    const facts = { changedLines: 0, maxChangedLines: 1000, stagedFiles: [] };
    expect(checkCommitMessage(`chore: tidy x\n\nCo-authored-by: ${ADA}\n`, facts)).toStrictEqual([unlisted(ADA)]);
  });

  it("refuses an AI tool as a co-author even when it is listed", () => {
    expect(check(`chore: tidy x\n\nCo-authored-by: ${CLAUDE}\n`)).toStrictEqual([
      `remove the attribution "Co-authored-by: ${CLAUDE}"; the work is the author's`,
    ]);
  });
});

describe("co-author lines: where they stand", () => {
  it("passes a co-author paragraph after a footer, a revert line or a why-line", () => {
    const line = `Co-authored-by: ${ADA}`;
    expect(check(`chore!: x\n\nBREAKING CHANGE: drops z\n\n${line}\n`)).toStrictEqual([]);
    expect(check(`revert: x\n\nThis reverts commit 5260cb8a1b2c.\n\n${line}\n`)).toStrictEqual([]);
    expect(check(`chore: x\n\nReformat from the bun fmt upgrade.\n\n${line}\n`, 1240)).toStrictEqual([]);
  });

  it("refuses a co-author that is not in the last paragraph, or shares it with other lines", () => {
    const line = `Co-authored-by: ${ADA}`;
    expect(check(`chore!: x\n\n${line}\n\nBREAKING CHANGE: drops z\n`)).toStrictEqual([moved(line)]);
    expect(check(`chore!: x\n\nBREAKING CHANGE: drops z\n${line}\n`)).toStrictEqual([moved(line)]);
    expect(check(`chore: x\n\nReformat from the bun fmt upgrade.\n${line}\n`, 1240)).toStrictEqual([moved(line)]);
  });

  it("does not take a co-author as the why of a commit over the size limit", () => {
    expect(check(`chore: x\n\nCo-authored-by: ${ADA}\n`, 1240)).toStrictEqual([
      "the commit changes 1240 lines, over the limit of 1000; add a body line saying why, or split it",
    ]);
  });
});
