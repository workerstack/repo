import path from "node:path";

import { describe, expect, it } from "vitest";

import { alreadyRtk, isWorkspaceJobScript, parseJobCommand, stripFlagValue } from "./gate-job.ts";
import { bashTargetsDenylist } from "./gate-paths.ts";

/** A dir that does not exist, so a glob in a command matches nothing, as in an empty dir. */
const NO_DIR = "/no-such-gate-dir";

const WS = "/planted/WS";
const roots = { checkout: WS, cwd: WS, root: WS };
const bin = path.join(WS, ["node_modules", ".bin", "repo"].join("/"));

describe("bashTargetsDenylist edges", () => {
  it("lets an empty or missing command through", () => {
    expect(bashTargetsDenylist(undefined, NO_DIR)).toBe(false);
    expect(bashTargetsDenylist("   ", NO_DIR)).toBe(false);
  });

  it("denies a dump of the lockfile or the git dir, not a plain mention", () => {
    expect(bashTargetsDenylist("cat bun.lock", NO_DIR)).toBe(true);
    expect(bashTargetsDenylist("grep x .git/config", NO_DIR)).toBe(true);
    expect(bashTargetsDenylist("echo bun.lock", NO_DIR)).toBe(false);
  });
});

describe("alreadyRtk", () => {
  it("is true for the rtk command or a path to it", () => {
    expect(alreadyRtk("rtk ls")).toBe(true);
    expect(alreadyRtk("/usr/bin/rtk ls")).toBe(true);
    expect(alreadyRtk("ls rtk")).toBe(false);
    expect(alreadyRtk("")).toBe(false);
  });
});

describe("stripFlagValue", () => {
  it("replaces a flag's value in either spelling and reads a missing command as empty", () => {
    expect(stripFlagValue("job --query 'a b' --x", "--query")).toBe("job --query _ --x");
    expect(stripFlagValue('job --query="a b"', "--query")).toBe("job --query=_");
  });
});

describe("parseJobCommand", () => {
  it("reads the job, query and stash flags in both spellings", () => {
    expect(parseJobCommand("bun repo job --job exec --query ls --stash s1", roots)).toStrictEqual({
      hasQuery: true,
      hasStash: true,
      job: "exec",
    });
    expect(parseJobCommand("bun repo job --job=TEST --query=ls --stash=s1", roots)).toStrictEqual({
      hasQuery: true,
      hasStash: true,
      job: "test",
    });
    expect(parseJobCommand("rtk bun repo job --path a --glob b", roots)).toStrictEqual({
      hasQuery: false,
      hasStash: false,
      job: "",
    });
  });

  it("reads a --job with no value as no job", () => {
    expect(parseJobCommand("bun repo job --job", roots)).toStrictEqual({ hasQuery: false, hasStash: false, job: "" });
  });
});

describe("parseJobCommand refusals", () => {
  it("refuses an empty command, missing roots, an unknown flag and shell syntax outside the query", () => {
    expect(parseJobCommand("", roots)).toBeNull();
    expect(parseJobCommand("bun repo job --job exec", null)).toBeNull();
    expect(parseJobCommand("bun repo job --bogus x", roots)).toBeNull();
    expect(parseJobCommand("bun repo job --job exec; ls", roots)).toBeNull();
    expect(parseJobCommand("bun repo job positional", roots)).toBeNull();
  });

  it("refuses a command that is not the job command", () => {
    expect(parseJobCommand("bun repo", roots)).toBeNull();
    expect(parseJobCommand("bun repo sync", roots)).toBeNull();
    expect(parseJobCommand("bun", roots)).toBeNull();
    expect(parseJobCommand("rtk", roots)).toBeNull();
    expect(parseJobCommand("ls job", roots)).toBeNull();
  });
});

describe("isWorkspaceJobScript", () => {
  it("accepts the installed bin by path, with or without bun and rtk", () => {
    expect(isWorkspaceJobScript(`${bin} job --job exec`, roots)).toBe(true);
    expect(isWorkspaceJobScript(`bun ${bin} job`, roots)).toBe(true);
    expect(isWorkspaceJobScript(`rtk ${bin}.exe job`, roots)).toBe(true);
    expect(isWorkspaceJobScript(`${bin} sync`, roots)).toBe(false);
  });

  it("rejects an empty command and missing roots", () => {
    expect(isWorkspaceJobScript("  ", roots)).toBe(false);
    expect(isWorkspaceJobScript(`${bin} job`, null)).toBe(false);
  });
});
