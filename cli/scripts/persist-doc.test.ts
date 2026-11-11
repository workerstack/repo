import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { FM_LINE_LOOSE_RE } from "./persist-doc.constants.ts";
import {
  captured,
  compactCreatedStamp,
  createdAtOf,
  createdLine,
  extractH1,
  freeName,
  frontmatterMap,
  hasKey,
  injectFrontmatter,
  nextSerial,
  parseFrontmatter,
  slugFromFilename,
  slugify,
  sourceLine,
  stripFrontmatter,
  utcDate,
  utcDateTime,
} from "./persist-doc.ts";

useTempDirs();

function tmp(): string {
  return tempDir("persist-doc-");
}

describe("names and stamps", () => {
  it("slugifies to lowercase words and caps the length", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("")).toBe("unnamed");
    expect(slugify("!!!")).toBe("unnamed");
    expect(slugify(`${"a".repeat(49)}-bbbb`)).toBe("a".repeat(49));
    expect(slugify("x".repeat(80))).toBe("x".repeat(50));
  });

  it("formats UTC times without milliseconds", () => {
    const d = new Date("2026-01-02T03:04:05.678Z");
    expect(utcDateTime(d)).toBe("2026-01-02T03:04:05Z");
    expect(utcDate(d)).toBe("2026-01-02");
    expect(utcDateTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(utcDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(compactCreatedStamp("2026-01-02T03:04:05Z")).toBe("20260102T030405Z");
  });

  it("reads the slug out of a stamped or unstamped filename", () => {
    expect(slugFromFilename("12-my-doc-20260102T030405Z.md")).toBe("my-doc");
    expect(slugFromFilename("3-old-name.md")).toBe("old-name");
  });

  it("reads the first heading", () => {
    expect(extractH1("intro\n# Title  \nbody")).toBe("Title");
    expect(extractH1("no heading")).toBe("");
  });

  it("returns a capture group as a string", () => {
    expect(captured(/(a)/.exec("a") ?? [], 1)).toBe("a");
  });
});

describe("nextSerial", () => {
  it("is 1 for a missing directory", () => {
    expect(nextSerial(path.join(tmp(), "missing"))).toBe(1);
  });

  it("is one past the highest numbered markdown file", () => {
    const dir = tmp();
    for (const f of ["2-a.md", "7-b.md", "9-c.txt", "notes.md"]) fs.writeFileSync(path.join(dir, f), "");
    expect(nextSerial(dir)).toBe(8);
    expect(nextSerial(dir, "")).toBe(10);
  });
});

describe("frontmatter", () => {
  const doc = '---\nserial: 4\nname: x\nsource: "a \\"q\\" b"\nempty:\nbad: "\\x"\n---\n# x\n';

  it("parses keys, decodes quoted values and keeps the body", () => {
    const fm = parseFrontmatter(doc);
    expect(fm.map).toStrictEqual({ bad: "\\x", empty: "", name: "x", serial: "4", source: 'a "q" b' });
    expect(fm.body).toBe("# x\n");
  });

  it("names a missing or unterminated block", () => {
    expect(parseFrontmatter("# x").error).toBe("missing frontmatter");
    expect(parseFrontmatter("---\nserial: 1\n").error).toBe("unterminated frontmatter");
  });

  it("reads loose lines when given the loose pattern", () => {
    expect(frontmatterMap("serial:4\nname:  x", FM_LINE_LOOSE_RE)).toStrictEqual({ name: "x", serial: "4" });
    expect(frontmatterMap("serial:4")).toStrictEqual({});
  });

  it("tells a present key from an absent one", () => {
    expect(hasKey({ a: "" }, "a")).toBe(true);
    expect(hasKey({ a: "" }, "b")).toBe(false);
  });

  it("strips a leading block and a byte-order mark, or leaves text without one", () => {
    expect(stripFrontmatter("\uFEFF---\nserial: 1\n---\nbody")).toBe("body");
    expect(stripFrontmatter("---\nunterminated")).toBe("---\nunterminated");
    expect(stripFrontmatter("plain")).toBe("plain");
  });
});

describe("injectFrontmatter", () => {
  it("writes the lines in order and retitles the first heading", () => {
    const out = injectFrontmatter(["serial: 1", "name: s"], "s", "\n\n# Old\n\ntext");
    expect(out).toBe("---\nserial: 1\nname: s\n---\n\n# s\n\ntext");
  });

  it("adds a heading when the body has none", () => {
    expect(injectFrontmatter(["serial: 1"], "s", "text")).toBe("---\nserial: 1\n---\n\n# s\n\ntext");
  });

  it("builds the source and created lines", () => {
    expect(sourceLine("a".repeat(130))).toBe(`source: "${"a".repeat(120)}"`);
    expect(sourceLine(undefined)).toBe('source: ""');
    expect(createdLine("2026-01-02")).toBe("created: 2026-01-02");
    expect(createdLine(undefined)).toMatch(/^created: \d{4}-/);
  });
});

describe("createdAtOf", () => {
  it("keeps a full UTC datetime and replaces anything else with now", () => {
    expect(createdAtOf("2026-01-02T03:04:05Z")).toBe("2026-01-02T03:04:05Z");
    expect(createdAtOf("2026-01-02")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(createdAtOf(undefined)).toMatch(/Z$/);
  });
});

describe("freeName", () => {
  const parts = { first: 3, slug: "s", stamp: "20260102T030405Z" };

  it("names the first serial when it is free", () => {
    const dir = tmp();
    expect(freeName(dir, parts)).toStrictEqual({
      dest: path.join(dir, "3-s-20260102T030405Z.md"),
      filename: "3-s-20260102T030405Z.md",
      serial: 3,
    });
  });

  it("counts up past taken names and takes the extension", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "3-s-20260102T030405Z.txt"), "");
    fs.writeFileSync(path.join(dir, "4-s-20260102T030405Z.txt"), "");
    expect(freeName(dir, { ...parts, ext: "txt" })?.serial).toBe(5);
  });

  it("gives up after five taken serials past the first", () => {
    const dir = tmp();
    for (let n = 3; n <= 8; n += 1) fs.writeFileSync(path.join(dir, `${n}-s-20260102T030405Z.md`), "");
    expect(freeName(dir, parts)).toBeUndefined();
    fs.rmSync(path.join(dir, "8-s-20260102T030405Z.md"));
    expect(freeName(dir, parts)?.serial).toBe(8);
  });
});
