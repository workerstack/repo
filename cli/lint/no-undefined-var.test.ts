import { describe, expect, it } from "vitest";

import { type Fixture, type RuleOptions, reportsOf } from "../../dev/rule-harness.ts";
import { noUndefinedVar } from "./no-undefined-var.ts";

/** An entry sheet whose graph is three deep: a sibling in `layer(theme)`, a package sheet with a `style` main. */
const SHEETS: Fixture = {
  "node_modules/pkg/base.css": ':root {\n  --pkg-good: 1;\n}\n@import url("https://fonts.example/x.css");\n',
  "node_modules/pkg/package.json": JSON.stringify({ main: "index.js", name: "pkg", style: "base.css" }),
  "src/app.css": [
    '@import "pkg";',
    '@import "./theme.css" layer(theme);',
    '@import url("./quoted.css");',
    '@reference "./ref.css";',
    "/* --commented: 1; */",
    "@property --ui-prop { syntax: '*'; inherits: false; }",
    ".a { --ui-good: 1; }",
  ].join("\n"),
  "src/quoted.css": '@import "./app.css";\n:root { --ui-quoted: 1; }',
  "src/ref.css": ":root { --ui-ref: 1; }",
  "src/theme.css": ":root { --ui-theme: 1; }",
};

const OPTIONS: RuleOptions = [{ entryPoint: "src/app.css", vars: ["--anchor-width", "--toast-*"] }];

/** `code` as the one source file `file`, beside `sheets`. */
function appWith(code: string, file = "src/app.tsx", sheets = SHEETS): Fixture {
  return { ...sheets, [file]: code };
}

/** What the rule reports over `fixture`, as messages. */
function messagesOf(fixture: Fixture, options: RuleOptions = OPTIONS): string[] {
  return reportsOf(noUndefinedVar, fixture, options).map((report) => report.message);
}

/** What the rule reports over `code` as `src/app.tsx`. */
function reports(code: string, options: RuleOptions = OPTIONS): string[] {
  return messagesOf(appWith(code), options);
}

describe("a var some sheet of the entry's graph defines", () => {
  it.each([
    ["the entry itself", "const a = 'var(--ui-good)';"],
    ["an at-property", "const a = 'var(--ui-prop)';"],
    ["an import with a layer", "const a = 'var(--ui-theme)';"],
    ["a package sheet through its style main", "const a = 'var(--pkg-good)';"],
    ["a url import, and a cycle back to the entry", "const a = 'var(--ui-quoted)';"],
    ["a reference", "const a = 'var(--ui-ref)';"],
    ["a utility", "const a = 'bg-(--ui-good) text-(length:--ui-theme)';"],
    ["a fallback", "const a = 'var(--ui-good, red)';"],
    ["a template part", "const a = `var(--ui-good) ${1}`;"],
    ["a name a template expression continues in var()", "const a = `var(--ui-${x})`;"],
    ["a name a template expression continues in a utility", "const a = `bg-(--ui-${x})`;"],
  ])("passes %s", (_name, code) => {
    expect(reports(code)).toStrictEqual([]);
  });

  it("passes a file in a subfolder, the entry being relative to the cwd", () => {
    expect(messagesOf(appWith("const a = 'var(--ui-good)';", "src/deep/er/app.tsx"))).toStrictEqual([]);
  });
});

describe("a var the file or the config accounts for", () => {
  it.each([
    ["a class that sets it", "const a = '[--local:1] var(--local)';"],
    ["a style key", "const a = { '--local': 1 }; const b = 'var(--local)';"],
    ["a listed name", "const a = 'var(--anchor-width)';"],
    ["a listed prefix", "const a = 'w-(--toast-offset)';"],
  ])("passes %s", (_name, code) => {
    expect(reports(code)).toStrictEqual([]);
  });

  it("reads no sheet when every var the file uses is its own, so a missing entry is not reported", () => {
    const options = [{ entryPoint: "src/missing.css", vars: ["--x"] }];

    expect(reports("const a = 'var(--local)'; const b = '--local';", options)).toStrictEqual([]);
  });

  it("reads no sheet for a file with no var", () => {
    expect(reports("const a = 'bg-red-500';", [{ entryPoint: "src/missing.css", vars: [] }])).toStrictEqual([]);
  });

  it("takes no listed vars as none", () => {
    expect(reports("const a = 'var(--ui-nope)';", [{ entryPoint: "src/app.css" }])).toHaveLength(1);
  });

  it("checks nothing without an entry", () => {
    expect(reports("const a = 'var(--ui-nope)';", [{ vars: [] }])).toStrictEqual([]);
    expect(reports("const a = 'var(--ui-nope)';", [])).toStrictEqual([]);
  });
});

/** The message for `name` when the sheets of `src/app.css` do not declare it. */
function notDefined(name: string): string {
  return (
    `"${name}" is not defined by src/app.css or a sheet it imports. Fix the name, define it in a sheet, ` +
    "or list it in lint.tailwind.vars when code sets it at runtime."
  );
}

describe("a var no sheet defines", () => {
  it.each([
    ["var()", "const a = 'var(--ui-nope)';"],
    ["a utility", "const a = 'bg-(--ui-nope)';"],
    ["a typed utility", "const a = 'w-(length:--ui-nope)';"],
    ["a fallback", "const a = 'var(--ui-nope, red)';"],
    ["a template part", "const a = `p-${1} var(--ui-nope)`;"],
    ["a complete name before an expression", "const a = `var(--ui-nope) ${x}`;"],
    ["a commented-out definition", "const a = 'var(--commented)';"],
  ])("fails %s", (_name, code) => {
    const [message] = reports(code);

    expect(message).toBe(notDefined(code.includes("--commented") ? "--commented" : "--ui-nope"));
  });

  it("fails each use", () => {
    expect(reports("const a = 'var(--ui-a) var(--ui-b)'; const b = 'var(--ui-a)';")).toStrictEqual([
      notDefined("--ui-a"),
      notDefined("--ui-b"),
      notDefined("--ui-a"),
    ]);
  });

  it("does not take a prefix listing for a name that only contains it", () => {
    expect(reports("const a = 'var(--my-toast-offset)';")).toHaveLength(1);
  });
});

describe("an import that does not resolve", () => {
  const broken: Fixture = { ...SHEETS, "src/app.css": '@import "./ui.generated.css";\n:root { --ui-good: 1; }' };

  it("is reported once per use, in place of an undefined var, whatever the unresolved import is", () => {
    const message =
      '"./ui.generated.css" in src/app.css does not resolve, so vars cannot be checked. ' +
      "Create the file or fix the import.";

    const code = "const a = 'var(--ui-good) var(--ui-x) w-(--ui-y)';";

    expect(messagesOf(appWith(code, "src/app.tsx", broken))).toStrictEqual([message, message]);
  });

  it("is reported for the first of several that do not resolve", () => {
    const sheets = { ...SHEETS, "src/app.css": '@import "./first.css";\n@import "./second.css";' };

    expect(messagesOf(appWith("const a = 'var(--ui-x)';", "src/app.tsx", sheets))).toStrictEqual([
      '"./first.css" in src/app.css does not resolve, so vars cannot be checked. Create the file or fix the import.',
    ]);
  });

  it("is reported for an entry that does not exist", () => {
    const options = [{ entryPoint: "src/none.css", vars: [] }];

    expect(reports("const a = 'var(--ui-x)';", options)).toStrictEqual([
      '"src/none.css" in lint.tailwind.entryPoint does not resolve, so vars cannot be checked. ' +
        "Create the file or fix the import.",
    ]);
  });
});
