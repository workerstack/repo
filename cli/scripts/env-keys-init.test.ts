/**
 * `bun repo env init` through env-keys.ts's `main(argv, deps)`; argv is what follows `bun repo env`, verb first. The
 * deps shape is spelled out in `__fixtures__/env-repo.ts`. Real temp git repos and a temp HOME; every key is made in
 * the test.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  envRepo,
  envRunner,
  KEY_LABEL,
  KEY_REL,
  keyFileIn,
  KEYS_JSON,
  keysFileFor,
  KEY_FILE_MODE,
  modeOf,
  short,
  SPAWN,
  unlocks,
  useEnvRepos,
} from "../__fixtures__/env-repo.ts";
import { newIdentity } from "../env/age.ts";
import { readKeysFile } from "../env/keys.ts";
import { main } from "./env-keys.ts";

const SET_UP = "repo env: already set up (acme)\n";
const run = envRunner(main);
const bare = { keyed: false, linked: false };

useEnvRepos();

describe("env init", () => {
  it("writes the keys file and a 0600 key file that unlocks its recipient", SPAWN, async () => {
    const w = await envRepo(bare);
    const got = await run(w, ["init"]);
    const keys = readKeysFile(w.repo);
    expect(keys?.repo).toBe("acme");
    const recipient = String(keys?.recipient);
    expect(got).toMatchObject({
      code: 0,
      err: "",
      out:
        `repo env: wrote .repo/env.keys.json (recipient ${short(recipient)}) and ${KEY_LABEL} (0600); ` +
        "back the key up in a password manager\n",
    });
    const keyFile = path.join(w.home, KEY_REL);
    expect(modeOf(keyFile)).toBe(KEY_FILE_MODE);
    expect(await unlocks(fs.readFileSync(keyFile, "utf8").trim(), recipient)).toBe(true);
  });

  it("writes at the git toplevel from a folder inside it, named for the toplevel", SPAWN, async () => {
    const w = await envRepo(bare);
    const got = await run(w, ["init"], { cwd: path.join(w.repo, "projects/shop") });
    expect(got.code).toBe(0);
    expect(fs.existsSync(path.join(w.repo, KEYS_JSON))).toBe(true);
    expect(fs.existsSync(path.join(w.repo, "projects/shop", KEYS_JSON))).toBe(false);
    expect(fs.existsSync(path.join(w.home, KEY_REL))).toBe(true);
  });
});

describe("env init, where it names and writes", () => {
  it("names a worktree's repo for its main checkout", SPAWN, async () => {
    const w = await envRepo(bare);
    const git = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"];
    execFileSync("git", [...git, "commit", "-q", "--allow-empty", "-m", "init"], { cwd: w.repo });
    const tree = path.join(path.dirname(w.repo), "acme-feature");
    execFileSync("git", ["worktree", "add", "-q", "-b", "feature", tree], { cwd: w.repo });
    const got = await run(w, ["init"], { cwd: tree });
    expect(got.code).toBe(0);
    expect(readKeysFile(tree)?.repo).toBe("acme");
    expect(fs.existsSync(path.join(w.home, KEY_REL))).toBe(true);
  });

  it("removes the key file it wrote when the keys file cannot be written, so a rerun sets up", SPAWN, async () => {
    const w = await envRepo(bare);
    fs.writeFileSync(path.join(w.repo, ".repo"), "not a folder\n");
    const got = await run(w, ["init"]);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(/^repo env: [^\n]*\n$/u);
    expect(fs.existsSync(path.join(w.home, KEY_REL))).toBe(false);
    fs.rmSync(path.join(w.repo, ".repo"));
    const rerun = await run(w, ["init"]);
    expect(rerun.code).toBe(0);
    expect(
      await unlocks(
        fs.readFileSync(path.join(w.home, KEY_REL), "utf8").trim(),
        String(readKeysFile(w.repo)?.recipient),
      ),
    ).toBe(true);
  });
});

describe("env init, a repo already set up", () => {
  it("says already set up on a rerun and leaves both files as they were", SPAWN, async () => {
    const w = await envRepo(bare);
    await run(w, ["init"]);
    const keysBefore = fs.readFileSync(path.join(w.repo, KEYS_JSON), "utf8");
    const keyBefore = fs.readFileSync(path.join(w.home, KEY_REL), "utf8");
    const got = await run(w, ["init"]);
    expect(got).toMatchObject({ code: 0, err: "", out: SET_UP });
    expect(fs.readFileSync(path.join(w.repo, KEYS_JSON), "utf8")).toBe(keysBefore);
    expect(fs.readFileSync(path.join(w.home, KEY_REL), "utf8")).toBe(keyBefore);
  });

  it("refuses a key file for another recipient and overwrites nothing", SPAWN, async () => {
    const w = await envRepo(bare);
    const owner = await newIdentity();
    const stranger = await newIdentity();
    keysFileFor(w.repo, owner.recipient);
    keyFileIn(w.home, "acme.key", stranger.identity);
    const keysBefore = fs.readFileSync(path.join(w.repo, KEYS_JSON), "utf8");
    const got = await run(w, ["init"]);
    expect(got).toMatchObject({
      code: 1,
      err: `repo env: init found ${KEY_LABEL} for another recipient; move it aside first\n`,
      out: "",
    });
    expect(fs.readFileSync(path.join(w.repo, KEYS_JSON), "utf8")).toBe(keysBefore);
    expect(fs.readFileSync(path.join(w.home, KEY_REL), "utf8")).toBe(`${stranger.identity}\n`);
    expect(got.err).not.toContain(stranger.identity);
  });
});
