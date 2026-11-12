import { describe, expect, it } from "vitest";

import { lesson } from "./__fixtures__/lessons-kit.ts";
import { globToRegExp, validateLesson } from "./lesson-file.ts";

describe("validateLesson", () => {
  const files = ["src/a.ts"];

  it("accepts a valid lesson", () => {
    expect(validateLesson("plan-forks.md", lesson(), { files })).toStrictEqual([]);
  });

  it("accepts a lesson a Windows checkout turned to CRLF", () => {
    expect(validateLesson("plan-forks.md", lesson().replaceAll("\n", "\r\n"), { files })).toStrictEqual([]);
  });

  it("rejects each broken shape with a reason that names the fix", () => {
    const cases: [string, string, RegExp][] = [
      ["plan-forks.md", lesson() + "\n".repeat(60), /60 lines/],
      ["plan-forks.md", lesson().replace(/\n## Fix[\s\S]*$/, "\n"), /## Fix/],
      ["plan-forks.md", `${lesson()}\n## Notes\nmore\n`, /## Mistake.*## Fix/],
      ["plan-forks.md", lesson({ paths: [] }), /paths/],
      ["other-name.md", lesson(), /other-name/],
      ["plan-forks.md", lesson({ paths: ["lib/**"] }), /lib\/\*\* matches no file/],
    ];

    for (const [file, text, reason] of cases)
      expect(validateLesson(file, text, { files }).join("; "), String(reason)).toMatch(reason);
  });
});

describe("globToRegExp", () => {
  it("handles **, *, and ?", () => {
    expect(globToRegExp("src/**").test("src/deep/b.ts")).toBe(true);
    expect(globToRegExp("src/**/b.ts").test("src/b.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/deep/b.ts")).toBe(false);
    expect(globToRegExp("src/?.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/?.ts").test("src/ab.ts")).toBe(false);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});
