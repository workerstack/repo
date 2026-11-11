import { describe, expect, it } from "vitest";

import { agentsFile } from "./agents-file.ts";
import { cutRegions, type Region, regionBody, regionHash, type RegionSyntax, writeRegions } from "./region.ts";

const ALPHA: Region = { body: "one\ntwo", name: "alpha", place: "bottom" };
const wrap = (syntax: RegionSyntax, words: string) => (syntax === "#" ? `# ${words}` : `<!-- ${words} -->`);
const open = (syntax: RegionSyntax, name: string, hash: string) => wrap(syntax, `repo:${name} ${hash}`);
const close = (syntax: RegionSyntax, name: string) => wrap(syntax, `/repo:${name}`);
/** The region as sync writes it. */
const block = (syntax: RegionSyntax, region: Region) =>
  [open(syntax, region.name, regionHash(region.body)), region.body, close(syntax, region.name)].join("\n");
/** A user's own `.gitignore` lines that look like a region: no hash, so sync never wrote them. */
const VENDORED = "# repo: vendored\nvendor/\n# /repo:vendored\nmine/\n";

describe("a marker-shaped line of a name no region lists", () => {
  it.each([
    ["an unhashed pair", "#", VENDORED],
    ["an unhashed stray open and close", "<!--", "<!-- repo:gone -->\nmine\n<!-- /repo:gone -->\n<!-- /repo:x -->\n"],
    ["a pair whose hash is not 8 hex", "<!--", "<!-- repo:gone abc -->\nmine\n<!-- /repo:gone -->\n"],
  ] as const)("is the user's text when it is %s: kept as is, with no repair", (_, syntax, before) => {
    const after = `${before}\n${block(syntax, ALPHA)}\n`;
    expect(writeRegions(before, syntax, [ALPHA])).toStrictEqual({ repairs: [], text: after });
    expect(writeRegions(after, syntax, [ALPHA])).toStrictEqual({ repairs: [], text: after });
  });

  it("leaves cutRegions nothing to cut in a file whose only marker-shaped lines sync did not write", () => {
    expect(cutRegions(VENDORED, "#")).toStrictEqual({ repairs: [], text: VENDORED });
  });

  it("is cut with its body when its open carries a hash sync wrote", () => {
    const before = `${open("#", "gone", regionHash("x"))}\nx\n${close("#", "gone")}\nmine/\n`;
    expect(writeRegions(before, "#", [])).toStrictEqual({ repairs: ["cut repo:gone"], text: "mine/\n" });
  });
});

describe("fenced code in markdown", () => {
  const sample = `${open("<!--", "alpha", regionHash(ALPHA.body))}\none\ntwo\n${close("<!--", "alpha")}`;
  it.each([
    ["a backtick fence", `# Doc\n\n\`\`\`md\n${sample}\n\`\`\`\n`],
    ["a tilde fence, indented up to 3 spaces", `   ~~~\n${sample}\n   ~~~~  \nafter\n`],
    ["a fence a shorter or other run does not close", `\`\`\`\`\n\`\`\`\n~~~~\n${sample}\n\`\`\`\`\n`],
  ])("reads no marker inside %s", (_, before) => {
    const after = `${before}\n${block("<!--", ALPHA)}\n`;
    expect(writeRegions(before, "<!--", [ALPHA])).toStrictEqual({ repairs: [], text: after });
    expect(writeRegions(after, "<!--", [ALPHA])).toStrictEqual({ repairs: [], text: after });
    expect(cutRegions(before, "<!--")).toStrictEqual({ repairs: [], text: before });
    expect(regionBody(before, "<!--", "alpha")).toBeUndefined();
  });

  it("reads markers after a closed fence, past a backtick line whose info string holds a backtick", () => {
    const before = `\`\`\`\nx\n\`\`\`\n\`\`\` a\`b\n${sample}\n`;
    expect(regionBody(before, "<!--", "alpha")).toBe("one\ntwo");
  });

  it("reads markers after a fence no line closes, so a region written below it reads back", () => {
    expect(regionBody(`\`\`\`\n${sample}\n`, "<!--", "alpha")).toBe("one\ntwo");
    const after = `\`\`\`\nmine\n\n${block("<!--", ALPHA)}\n`;
    expect(writeRegions("```\nmine\n", "<!--", [ALPHA])).toStrictEqual({ repairs: [], text: after });
    expect(writeRegions(after, "<!--", [ALPHA])).toStrictEqual({ repairs: [], text: after });
  });

  it("is no fence in a hash file, where a backtick line is a pattern", () => {
    const before = `\`\`\`\n${open("#", "gone", regionHash("x"))}\nx\n${close("#", "gone")}\n\`\`\`\n`;
    expect(cutRegions(before, "#")).toStrictEqual({ repairs: ["cut repo:gone"], text: "```\n```\n" });
  });
});

const RULES = "Stock rule.\n";
const IGNORE: Region = { body: "dist/\nout/", name: "ignore", place: "bottom" };
/** The `repo:rules` region holding `RULES`, its marker lines ending in `end`. */
function rules(end = "\n"): string {
  return `${open("<!--", "rules", regionHash(RULES))}${end}${RULES}${close("<!--", "rules")}${end}`;
}
function agents(text: string) {
  return agentsFile("AGENTS.md", RULES, { history: {}, text });
}
function crlf(text: string): string {
  return text.replaceAll("\n", "\r\n");
}

describe("a marker line ending in CR", () => {
  it("is rewritten LF in a file whose other lines are LF, and says so", () => {
    expect(agents(`Mine.\n\n${rules("\r\n")}`)).toMatchObject({
      content: `Mine.\n\n${rules()}`,
      repairs: ["rewrote the markers of repo:rules"],
    });
    const disk = `mine/\n${open("#", "ignore", regionHash(IGNORE.body))}\r\ndist/\nout/\n${close("#", "ignore")}\r\n`;
    expect(writeRegions(disk, "#", [IGNORE])).toStrictEqual({
      repairs: ["rewrote the markers of repo:ignore"],
      text: `mine/\n${block("#", IGNORE)}\n`,
    });
  });

  it("is no repair in a whole-CRLF file, as a Windows checkout writes every shared file", () => {
    expect(agents(crlf(`Mine.\n\n${rules()}`))).not.toHaveProperty("repairs");
    const ignore = `mine/\n\n${block("#", IGNORE)}\n`;
    expect(writeRegions(crlf(ignore), "#", [IGNORE])).toStrictEqual({ repairs: [], text: ignore });
  });

  it("is no repair when only a user line ends in CR", () => {
    expect(agents(`Mine.\r\n\n${rules()}`)).not.toHaveProperty("repairs");
  });
});
