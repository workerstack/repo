import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { removeTree } from "../remove-tree.ts";
import { main } from "./main.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function into(lines: string[]) {
  return (text: string | Uint8Array): boolean => (lines.push(text.toString()), true);
}

/** Runs `main` with stdout and stderr captured. */
async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(into(out));
  vi.spyOn(process.stderr, "write").mockImplementation(into(err));
  const code = await main(argv);

  return { code, err: err.join(""), out: out.join("") };
}

const TAG_FORMAT = "name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0\n";

const USAGE =
  "usage: repo release [--stable | --pre <id>] | wait | gate | pack | publish | github <name>@<version> " +
  "| consumer [<tarball>] | api [--against <tarball>]\n";

describe("repo release", () => {
  it("prints the usage for help", async () => {
    expect(await run(["help"])).toStrictEqual({ code: 0, err: "", out: USAGE });
  });

  it("sends `wait` to the npm poll", async () => {
    expect(await run(["wait"])).toStrictEqual({ code: 1, err: `repo release wait: ${TAG_FORMAT}`, out: "" });
  });

  it.each(["gate", "publish", "github"])("sends `%s` to its command", async (command) => {
    expect(await run([command])).toStrictEqual({ code: 1, err: `repo release ${command}: ${TAG_FORMAT}`, out: "" });
  });

  it("sends `pack` to the packer", async () => {
    const got = await run(["pack", "extra"]);
    expect(got.err).toBe("repo release pack: takes no arguments; it packs the package in this checkout\n");
  });

  it("sends `api` to the public type diff", async () => {
    const got = await run(["api", "--nope"]);
    expect(got.err).toBe("repo release api: usage: repo release api [--against <tarball>]\n");
  });

  it("sends `consumer` to the consumer test", async () => {
    const got = await run(["consumer", "a.tgz", "b.tgz"]);
    expect(got).toStrictEqual({
      code: 1,
      err: "repo release consumer: takes at most one argument, the tarball to test\n",
      out: "",
    });
  });
});

describe("repo release consumer", () => {
  it("removes the project of a consumer test whose install fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-consumer-"));

    try {
      const tarball = path.join(dir, "not-a-package.tgz");
      fs.writeFileSync(tarball, "not a tarball");
      const got = await run(["consumer", tarball]);
      expect(got).toMatchObject({ code: 1, out: "" });
      expect(got.err).toMatch(/^repo release consumer: bun add failed: /);
    } finally {
      removeTree(dir);
    }
  });

  it("sends anything else to the release", async () => {
    expect(await run(["--bogus"])).toStrictEqual({ code: 1, err: `repo release: ${USAGE}`, out: "" });
  });
});
