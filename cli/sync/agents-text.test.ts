import { describe, expect, it } from "vitest";
import { extraH2Sections, extractUserMarkdown } from "./agents-text.ts";

describe("extractUserMarkdown", () => {
  it("keeps the text outside the block and drops stray end markers", () => {
    expect(extractUserMarkdown("<!-- repo:begin -->\nbody\n<!-- repo:end -->\n<!-- repo:end -->\n")).toBe("");
    expect(extractUserMarkdown("<!-- repo:begin -->\nbody\n<!-- repo:end -->\nkeep\n<!-- repo:end -->\n")).toBe("keep\n");
    expect(extractUserMarkdown("<!-- repo:begin -->\n\nbody\n\n<!-- repo:end -->\n\n# Mine\n")).toBe("\n# Mine\n");
    expect(extractUserMarkdown("keep <!-- repo:end --> me")).toBe("keep  me");
    expect(extractUserMarkdown("keep\n<!-- repo:end -->\nme")).toBe("keep\nme");
    expect(extractUserMarkdown("keep\n  <!-- repo:end -->  \nme")).toBe("keep\nme");
  });

  it("cuts an unclosed block to the end", () => {
    expect(extractUserMarkdown("<!-- repo:begin -->\nok\n<!-- repo:end -->\nuser bit\n<!-- repo:begin -->\nstale")).toBe("user bit\n");
  });
});

describe("extraH2Sections", () => {
  it("keeps titles incoming does not have, including CRLF", () => {
    const existing = "# Law\r\n\r\n## Skills naming\r\n\r\nstock\r\n\r\n## Autorun\r\n\r\ngo-live\r\n";
    const incoming = "# Law\n\n## Skills naming\n\nstock plus su\n";
    expect(extraH2Sections(existing, incoming)).toBe("## Autorun\n\ngo-live");
    expect(extraH2Sections("# Law\n\nno headings\n", incoming)).toBe("");
    expect(extraH2Sections("## \nempty title\n## Autorun\nkeep\n", incoming)).toBe("## Autorun\nkeep");
  });
});
