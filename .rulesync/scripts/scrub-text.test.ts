import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  autoMd,
  collapseBlankRuns,
  collapseInternalWs,
  decodeUtf8,
  fenceMatch,
  helpText,
  intentMode,
  normalizeMd,
  normalizeNewlines,
  normalizePlain,
  parseArgs,
  scrubText,
  stripFiller,
  trimEdgeBlanks,
} from "./scrub-text-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cli = path.join(here, "scrub-text");
const fixtures = path.join(here, "fixtures");

function fixturePath(name: string) {
  return path.join(fixtures, name);
}

function loadFixture(name: string) {
  return readFileSync(fixturePath(name), "utf8");
}

function cliStdout(text: string) {
  if (!text) return "";
  return text.endsWith("\n") ? text : `${text}\n`;
}

const tempDirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "scrub-text-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function runCli(
  args: string[],
  opts: { input?: string | Buffer; cwd?: string } = {},
) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input: opts.input,
    cwd: opts.cwd ?? root,
    timeout: 10_000,
  });
}

describe("normalizePlain", () => {
  it("collapses internal whitespace and trailing spaces", () => {
    expect(normalizePlain("hello   world  \t ")).toBe("hello world");
  });

  it("collapses extra blank lines to a single blank, then drops blanks for short lines", () => {
    const input = "alpha\n\n\n\nbeta\n\ngamma\n";
    expect(normalizePlain(input)).toBe("alpha\nbeta\ngamma");
  });

  it("trims leading and trailing blank lines", () => {
    expect(normalizePlain("\n\nkeep me\n\n")).toBe("keep me");
  });

  it("keeps a blank line when any non-empty line is longer than 80 chars", () => {
    const long = "x".repeat(81);
    const input = `${long}\n\nshort`;
    expect(normalizePlain(input)).toBe(`${long}\n\nshort`);
  });

  it("normalizes CRLF and CR to LF before collapsing", () => {
    expect(normalizePlain("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("normalizeMd", () => {
  it("preserves intentional blank lines inside fenced code blocks", () => {
    const input = [
      "# Title",
      "",
      "",
      "",
      "Intro paragraph.",
      "",
      "```js",
      "const a = 1;",
      "",
      "",
      "const b = 2;",
      "```",
      "",
      "Outro.",
      "",
    ].join("\n");

    const out = normalizeMd(input);
    expect(out).toContain("```js\nconst a = 1;\n\n\nconst b = 2;\n```");
    expect(out).toBe(
      [
        "# Title",
        "",
        "",
        "Intro paragraph.",
        "",
        "```js",
        "const a = 1;",
        "",
        "",
        "const b = 2;",
        "```",
        "",
        "Outro.",
      ].join("\n"),
    );
  });

  it("does not collapse internal whitespace outside fences (only trailing)", () => {
    expect(normalizeMd("hello   world  ")).toBe("hello   world");
  });

  it("caps consecutive blanks outside fences at two", () => {
    expect(normalizeMd("a\n\n\n\n\nb")).toBe("a\n\n\nb");
  });

  it("supports tilde fences and does not close on a shorter marker", () => {
    const input = "~~~\nkeep\n\n~~\nstill\n~~~\n";
    expect(normalizeMd(input)).toBe("~~~\nkeep\n\n~~\nstill\n~~~");
  });
});

describe("autoMd", () => {
  it("is false for stdin (no files)", () => {
    expect(autoMd([], false, false)).toBe(false);
  });

  it("is true when every file is .md or .markdown", () => {
    expect(autoMd(["notes.md", "README.MARKDOWN"], false, false)).toBe(true);
  });

  it("is false when any file is not markdown", () => {
    expect(autoMd(["notes.md", "plain.txt"], false, false)).toBe(false);
  });

  it("--md forces true and --no-md wins", () => {
    expect(autoMd(["plain.txt"], true, false)).toBe(true);
    expect(autoMd(["notes.md"], true, true)).toBe(false);
    expect(autoMd(["notes.md"], false, true)).toBe(false);
  });
});

describe("intent / filler", () => {
  it("turns the counter fixture into the expected one-liner", () => {
    const text = scrubText(loadFixture("bad-prompt-counter.md"), {
      intent: true,
    });
    expect(text).toBe("make counter react app ui loook minimal");
  });

  it("strips common filler prefixes", () => {
    const prefixes = [
      "can you please",
      "could you please",
      "would you please",
      "can you",
      "could you",
      "would you",
      "please",
      "i want you to",
      "i need you to",
      "i would like you to",
      "i'd like you to",
    ];
    for (const prefix of prefixes) {
      expect(stripFiller(`${prefix} ship it`)).toBe("ship it");
    }
  });

  it("strips trailing thanks/please and mid-sentence filler", () => {
    expect(intentMode("Please make me a demo, thanks!")).toBe("make demo");
    expect(stripFiller("build the ui to , look small please")).toBe(
      "build the ui look small",
    );
  });

  it("maps remaining mid-intent phrases", () => {
    expect(stripFiller("make me an api")).toBe("make api");
    expect(stripFiller("i want the docs")).toBe("docs");
    expect(stripFiller("i need the logs")).toBe("logs");
    expect(stripFiller("i want a demo")).toBe("demo");
    expect(stripFiller("i need a patch")).toBe("patch");
    expect(stripFiller("i want coffee")).toBe("coffee");
    expect(stripFiller("i need coffee")).toBe("coffee");
  });

  it("keeps typos (no spellcheck)", () => {
    expect(intentMode("can you make me a loook minimal ui")).toBe(
      "make loook minimal ui",
    );
  });
});

describe("parseArgs / help / decodeUtf8", () => {
  it("parses flags, files, --, and unknown options", () => {
    expect(
      parseArgs(["--intent", "--md", "a.md", "--", "--no-md", "b.txt"]),
    ).toEqual({
      help: false,
      intent: true,
      md: true,
      noMd: false,
      files: ["a.md", "--no-md", "b.txt"],
      unknown: [],
    });
    expect(parseArgs(["-h", "--bogus", "-x"])).toMatchObject({
      help: true,
      unknown: ["--bogus", "-x"],
    });
    expect(parseArgs(["-"])).toMatchObject({ files: ["-"], unknown: [] });
  });

  it("exposes usage text", () => {
    expect(helpText()).toMatch(/Usage: scrub-text/);
    expect(helpText()).toMatch(/--intent/);
  });

  it("rejects invalid UTF-8 with a labeled error", () => {
    expect(() => decodeUtf8(Buffer.from([0xff]), "stdin")).toThrow(/stdin:/);
    expect(decodeUtf8(Buffer.from("ok"), "stdin")).toBe("ok");
  });

  it("exports blank/ws/fence helpers", () => {
    expect(collapseBlankRuns(["a", "", "", "", "b"], 2)).toEqual([
      "a",
      "",
      "",
      "b",
    ]);
    expect(trimEdgeBlanks(["", "keep", ""])).toEqual(["keep"]);
    expect(collapseInternalWs("  a \t  b  ")).toBe("a b");
    expect(fenceMatch("```js")?.[2]).toBe("```");
    expect(fenceMatch("not a fence")).toBeNull();
  });

  it("normalizes newlines independently", () => {
    expect(normalizeNewlines("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

const fixtureCases: {
  file: string;
  md: boolean;
  normalize: string;
  intent: string;
}[] = [
  {
    file: "bad-prompt-counter.md",
    md: true,
    normalize: "please make me a counter react app ui loook minimal thanks",
    intent: "make counter react app ui loook minimal",
  },
  {
    file: "bad-prompt-please-filler.txt",
    md: false,
    normalize: "can you please build the ui to , look small please",
    intent: "build the ui look small",
  },
  {
    file: "bad-prompt-whitespace.txt",
    md: false,
    normalize: "hello world\nfoo bar",
    intent: "hello world foo bar",
  },
  {
    file: "bad-prompt-thanks-suffix.txt",
    md: false,
    normalize: "build the demo, thanks!",
    intent: "build the demo",
  },
  {
    file: "md-with-fence.md",
    md: true,
    normalize: [
      "# Title",
      "",
      "",
      "Intro paragraph.",
      "",
      "```js",
      "const a = 1;",
      "",
      "",
      "const b = 2;",
      "```",
      "",
      "Outro.",
    ].join("\n"),
    intent:
      "# Title Intro paragraph. ```js const a = 1; const b = 2; ``` Outro.",
  },
  {
    file: "md-headings-lists.md",
    md: true,
    normalize: "# Tasks\n\n\n- one\n- two\n\n\n## Done",
    intent: "# Tasks - one - two ## Done",
  },
  {
    file: "clean-intent-already.txt",
    md: false,
    normalize: "make counter react app ui loook minimal",
    intent: "make counter react app ui loook minimal",
  },
  {
    file: "multiline-requirements.md",
    md: true,
    // --intent joins non-empty lines; headings/lists are smashed on purpose
    normalize:
      "# Login\n\nAdd a login form.\n\n- validate email\n- persist session",
    intent: "# Login Add a login form. - validate email - persist session",
  },
  {
    file: "crlf-junk.txt",
    md: false,
    normalize: "alpha\nbeta\ngamma",
    intent: "alpha beta gamma",
  },
  {
    file: "empty-and-blanks.txt",
    md: false,
    normalize: "",
    intent: "",
  },
  {
    file: "code-paste-with-prose.md",
    md: true,
    normalize:
      "Here is a helper.\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\n```\n\nUse it.",
    // --intent also strips commas, so `add(a, b)` becomes `add(a b)`
    intent:
      "Here is a helper. ```js function add(a b) { return a + b; } ``` Use it.",
  },
  {
    file: "tabs-and-spaces.txt",
    md: false,
    normalize: "hello world\nkeep me",
    intent: "hello world keep me",
  },
];

describe("fixtures", () => {
  it.each(fixtureCases)("normalizes $file", ({ file, md, normalize }) => {
    expect(scrubText(loadFixture(file), { md })).toBe(normalize);
  });

  it.each(fixtureCases)("intent on $file", ({ file, md, intent }) => {
    expect(scrubText(loadFixture(file), { md, intent: true })).toBe(intent);
  });

  it("loads fixtures from scripts/fixtures, not repo root", () => {
    expect(fixturePath("bad-prompt-counter.md")).toBe(
      path.join(here, "fixtures", "bad-prompt-counter.md"),
    );
    expect(fixturePath("bad-prompt-counter.md")).not.toBe(
      path.join(root, "bad-prompt-counter.md"),
    );
  });
});

describe("CLI integration", () => {
  it("scrubs the counter fixture with --intent", () => {
    const result = runCli([
      "--intent",
      fixturePath("bad-prompt-counter.md"),
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("make counter react app ui loook minimal\n");
    expect(result.stderr).toBe("");
  });

  it.each(fixtureCases)(
    "CLI default normalize $file",
    ({ file, normalize }) => {
      const result = runCli([fixturePath(file)]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(cliStdout(normalize));
      expect(result.stderr).toBe("");
    },
  );

  it.each(fixtureCases)("CLI --intent $file", ({ file, intent }) => {
    const result = runCli(["--intent", fixturePath(file)]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(cliStdout(intent));
    expect(result.stderr).toBe("");
  });

  it("reads stdin when no FILE is given", () => {
    const result = runCli([], { input: "hello   world\n\n\n" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("hello world\n");
  });

  it("auto-enables md mode for .md paths", () => {
    const dir = tempDir();
    const file = path.join(dir, "sample.md");
    writeFileSync(
      file,
      ["para", "", "", "", "```", "a", "", "", "b", "```", ""].join("\n"),
    );
    const result = runCli([file]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("para\n\n\n```\na\n\n\nb\n```\n");
  });

  it("--no-md disables auto md for .md files", () => {
    const dir = tempDir();
    const file = path.join(dir, "sample.md");
    writeFileSync(file, "hello   world\n\n\nnext\n");
    const result = runCli(["--no-md", file]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("hello world\nnext\n");
  });

  it("exits 1 for a missing file", () => {
    const missing = path.join(tempDir(), "no-such-file.txt");
    const result = runCli([missing]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/scrub-text: /);
    expect(result.stderr).toMatch(/ENOENT|no such file/i);
    expect(result.stdout).toBe("");
  });

  it("prints help and exits 0", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage: scrub-text/);
  });

  it("exits 2 on unrecognized arguments", () => {
    const result = runCli(["--not-a-flag"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/unrecognized arguments: --not-a-flag/);
  });
});
