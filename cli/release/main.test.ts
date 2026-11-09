import { afterEach, describe, expect, it } from "vitest";
import { main } from "./main.ts";

const write = process.stderr.write;
afterEach(() => {
  process.stderr.write = write;
});

/** Runs `main` with stderr captured. */
async function run(argv: string[]) {
  const err: string[] = [];
  const capture = (text: string): boolean => {
    err.push(text);
    return true;
  };
  process.stderr.write = capture /* the code writes strings only */ as typeof process.stderr.write;
  const code = await main(argv);
  return { code, err: err.join("") };
}

describe("repo release", () => {
  it("sends `wait` to the npm poll", async () => {
    expect(await run(["wait"])).toEqual({
      code: 1,
      err: "repo release wait: name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0\n",
    });
  });

  it("sends anything else to the release", async () => {
    const got = await run(["--bogus"]);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(/^repo release: usage: bun repo release/);
  });
});
