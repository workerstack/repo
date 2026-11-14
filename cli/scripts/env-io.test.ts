/**
 * The plumbing of the `bun repo env` verbs: the real io's pieces run for real (a bun child stands in for gh and for a
 * `run` command), argv reading, and the one-line refusals.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it, onTestFinished } from "vitest";

import { childEnv } from "../env.ts";
import { removeTree } from "../remove-tree.ts";
import { isKeyName, isScopeName, parseArgs, type ArgSpec } from "./env-args.ts";
import { guarded, hiddenPrompt, inputRunner, ioOf, repoRoot, spawnInherit, textOf } from "./env-io.ts";

const SPAWN = { timeout: 30_000 };
const BUN = process.execPath;
const GET: ArgSpec = { command: "none", switches: ["--reveal"], values: ["--scope"], words: 1 };

/** A temp folder outside any git repo, removed when the test ends. */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-io-"));
  onTestFinished(() => {
    removeTree(dir);
  });

  return dir;
}

describe("the real io", () => {
  it("runs in this folder over this process's env, and writes through its streams", () => {
    const io = ioOf();
    expect(io.cwd).toBe(process.cwd());
    expect(io.env).toStrictEqual(childEnv());
    expect(io.isTTY).toBe(process.stdin.isTTY);
    expect(() => {
      io.stdout("");
      io.stderr("");
    }).not.toThrow();
  });

  it("takes each dep given over the real one", () => {
    expect(ioOf({ cwd: "/elsewhere", home: "/home/else" })).toMatchObject({ cwd: "/elsewhere", home: "/home/else" });
  });

  it("asks the hidden prompt with the message", async () => {
    const asked: { message: string }[] = [];

    const prompt = hiddenPrompt((options) => {
      asked.push(options);

      return Promise.resolve("answer");
    });

    expect(await prompt("prod.KEY")).toBe("answer");
    expect(asked).toStrictEqual([{ message: "prod.KEY" }]);
  });

  it("reads a whole stream as text", async () => {
    expect(await textOf(Readable.from([Buffer.from("one\n"), Buffer.from("two")]))).toBe("one\ntwo");
  });
});

describe("inputRunner", () => {
  it("hands the tool its input on stdin and captures what it prints", SPAWN, () => {
    const run = inputRunner(BUN);
    const got = run(["-e", "process.stdout.write((await Bun.stdin.text()).toUpperCase())"], tempDir(), "key");
    expect(got).toStrictEqual({ code: 0, stderr: "", stdout: "KEY" });
  });

  it("is a failed run, exit 1, when the tool is killed by a signal", SPAWN, () => {
    const got = inputRunner(BUN)(["-e", "process.kill(process.pid, 'SIGKILL')"], tempDir(), "");
    expect(got.code).toBe(1);
  });

  it("is a failed run with the reason when the tool cannot start", () => {
    const got = inputRunner("no-such-tool-for-env-io")([], tempDir(), "");
    expect(got.code).toBe(1);
    expect(got.stderr).toContain("no-such-tool-for-env-io");
  });
});

describe("spawnInherit", () => {
  it("resolves to the child's exit code", SPAWN, async () => {
    expect(await spawnInherit([BUN, "-e", "process.exit(3)"], { cwd: tempDir(), env: childEnv() })).toBe(3);
  });

  it("resolves to 1 when the child is killed by a signal", SPAWN, async () => {
    const command = [BUN, "-e", "process.kill(process.pid, 'SIGKILL')"];
    expect(await spawnInherit(command, { cwd: tempDir(), env: childEnv() })).toBe(1);
  });

  it("throws a line naming a command that cannot start", () => {
    expect(() => spawnInherit(["no-such-tool-for-env-io"], { cwd: tempDir(), env: childEnv() })).toThrow(
      /^repo env: could not run no-such-tool-for-env-io: /u,
    );
  });
});

describe("guarded", () => {
  it.each([
    ["a refusal as it is", new Error("repo env: no key\nmore"), "repo env: no key\n"],
    ["another error prefixed", new Error("EACCES: denied"), "repo env: EACCES: denied\n"],
    ["a thrown value prefixed", "boom", "repo env: boom\n"],
  ])("prints %s on one line, exit 1", async (_label, thrown, line) => {
    let err = "";

    const io = ioOf({
      stderr: (s: string) => {
        err += s;
      },
    });

    expect(await guarded(io, () => Promise.reject(thrown))).toBe(1);
    expect(err).toBe(line);
  });
});

describe("repoRoot", () => {
  it("refuses a folder outside any git repo", () => {
    expect(() => repoRoot(tempDir())).toThrow("repo env: not inside a git repo; run it in one");
  });
});

describe("parseArgs", () => {
  it("reads words, flag values and switches", () => {
    expect(parseArgs(["KEY", "--scope", "prod", "--reveal"], GET)).toStrictEqual({
      command: [],
      switches: new Set(["--reveal"]),
      values: new Map([["--scope", "prod"]]),
      words: ["KEY"],
    });
  });

  it.each([
    ["a flag missing its value", ["KEY", "--scope"]],
    ["an unknown flag", ["KEY", "--nope"]],
    ["a command where none is taken", ["KEY", "--", "echo"]],
    ["too many words", ["KEY", "value"]],
  ])("refuses %s", (_label, argv) => {
    expect(parseArgs(argv, GET)).toBeNull();
  });

  it.each(["", "1KEY", "KEY-NAME", undefined])("does not take %s as a key", (name) => {
    expect(isKeyName(name)).toBe(false);
  });

  it.each(["staging", "", undefined])("does not take %s as a scope", (name) => {
    expect(isScopeName(name)).toBe(false);
  });
});
