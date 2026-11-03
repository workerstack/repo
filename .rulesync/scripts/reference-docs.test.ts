import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fencedLineSet } from "./persist-plan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const referenceDir = path.join(here, "..", "reference");

/** Structure errors a doc pasted over itself leaves behind: a heading repeated, or heading markup glued mid-line. */
function headingErrors(text: string) {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const lines = text.split("\n");
  const { fenced } = fencedLineSet(lines);
  lines.forEach((line, i) => {
    if (fenced.has(i)) return;
    const bare = line.replace(/`[^`]*`/g, "");
    const heading = /^(#{1,6}) +(.*\S)\s*$/.exec(bare);
    if (heading) {
      const key = `${heading[1]} ${heading[2]}`;
      const first = seen.get(key);
      if (first) errors.push(`line ${i + 1}: repeated heading "${key}" (first at line ${first}): remove or rename it`);
      else seen.set(key, i + 1);
    }
    if (/[^\s#]#{1,6} /.test(bare)) errors.push(`line ${i + 1}: heading markup mid-line: put the heading on its own line`);
  });
  return errors;
}

describe("reference docs", () => {
  it("flags repeated and glued headings, not fenced or inline ones", () => {
    const text = ["## Path", "```md", "## Goal", "```", "see `## x` here", "## Path", "text# Plan format"].join("\n");
    expect(headingErrors(text)).toEqual([
      'line 6: repeated heading "## Path" (first at line 1): remove or rename it',
      "line 7: heading markup mid-line: put the heading on its own line",
    ]);
  });

  for (const name of fs.readdirSync(referenceDir).filter((n) => n.endsWith(".md"))) {
    it(`${name} has each heading once, each on its own line`, () => {
      expect(headingErrors(fs.readFileSync(path.join(referenceDir, name), "utf8"))).toEqual([]);
    });
  }
});
