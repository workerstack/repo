import { describe, expect, it } from "vitest";

import { HEADER, context } from "../__fixtures__/release-context.ts";
import { release } from "./release.ts";

const CI = ".github/workflows/ci.yml";
const DEPENDABOT = ".github/dependabot.yml";
const REFUSAL = "is hand-written; delete it so repo sync can own it";

const CONTENT = [
  "version: 2",
  "updates:",
  "  - package-ecosystem: github-actions",
  "    directory: /",
  "    schedule:",
  "      interval: weekly",
  "    cooldown:",
  "      default-days: 7",
  "    groups:",
  "      github-actions:",
  '        patterns: ["*"]',
  "",
].join("\n");

describe("release dependabot.yml", () => {
  it("writes the github-actions ecosystem weekly, in one group, with a 7 day cooldown", () => {
    const out = release(context(["release"])).outputs[1];
    expect(out).toStrictEqual({
      content: CONTENT,
      kind: "file",
      managed: "whole",
      path: DEPENDABOT,
      tracked: true,
    });
  });

  it("writes nothing without the release pack", () => {
    expect(release(context(["standards"]))).toStrictEqual({ errors: [], outputs: [] });
  });
});

describe("release dependabot.yml ownership", () => {
  it("refuses a hand-written dependabot.yml", () => {
    expect(release(context(["release"], {}, { [DEPENDABOT]: "version: 2\n" }))).toStrictEqual({
      errors: [`${DEPENDABOT} ${REFUSAL}`],
      outputs: [],
    });
  });

  it("rewrites a dependabot.yml that carries the generated header", () => {
    const got = release(context(["release"], {}, { [DEPENDABOT]: `${HEADER}\nversion: 2\n` }));
    expect(got.errors).toStrictEqual([]);
    expect(got.outputs).toHaveLength(2);
  });

  it("refuses both files when both are hand-written", () => {
    const files = { [CI]: "name: x\n", [DEPENDABOT]: "version: 2\n" };
    const { errors } = release(context(["release"], {}, files));
    expect(errors).toStrictEqual([`${CI} ${REFUSAL}`, `${DEPENDABOT} ${REFUSAL}`]);
  });
});
