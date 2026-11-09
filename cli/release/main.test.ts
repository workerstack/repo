import { afterEach, describe, expect, it } from "vitest";
import { main } from "./main.ts";

const writeErr = process.stderr.write;
const writeOut = process.stdout.write;
afterEach(() => {
  process.stderr.write = writeErr;
  process.stdout.write = writeOut;
});

/** Runs `main` with stdout and stderr captured. */
async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const into =
    (lines: string[]) =>
    (text: string): boolean => (lines.push(text), true);
  process.stdout.write = into(out) /* the code writes strings only */ as typeof process.stdout.write;
  process.stderr.write = into(err) /* the code writes strings only */ as typeof process.stderr.write;
  const code = await main(argv);
  return { code, out: out.join(""), err: err.join("") };
}

const TAG_FORMAT = "name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0\n";
const USAGE = "usage: repo release [--stable | --pre <id>] | wait | gate | pack | publish | github <name>@<version>\n";

describe("repo release", () => {
  it("prints the usage for help", async () => {
    expect(await run(["help"])).toEqual({ code: 0, out: USAGE, err: "" });
  });

  it("sends `wait` to the npm poll", async () => {
    expect(await run(["wait"])).toEqual({ code: 1, out: "", err: `repo release wait: ${TAG_FORMAT}` });
  });

  it.each(["gate", "publish", "github"])("sends `%s` to its command", async (command) => {
    expect(await run([command])).toEqual({ code: 1, out: "", err: `repo release ${command}: ${TAG_FORMAT}` });
  });

  it("sends `pack` to the packer", async () => {
    const got = await run(["pack", "extra"]);
    expect(got.err).toBe("repo release pack: takes no arguments; it packs the package in this checkout\n");
  });

  it("sends anything else to the release", async () => {
    expect(await run(["--bogus"])).toEqual({ code: 1, out: "", err: `repo release: ${USAGE}` });
  });
});
