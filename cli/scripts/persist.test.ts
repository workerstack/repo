import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { DRAFT_ROADMAP, VALID_HANDOFF, VALID_IMPL, VALID_PLAN, VALID_TMP } from "./__fixtures__/persist-bodies.ts";
import { parsePersistCliJson, runPersistCli } from "./__fixtures__/run-persist-cli.ts";
import type { HookIo } from "./hook-io.ts";
import { main } from "./persist.ts";

const { tempDir, track } = useTempDirs("persist-main-");

function tmpDir(): string {
  return fs.realpathSync(tempDir());
}

/** An io that hands `body` out in 100-byte chunks, then reports the stream closed; `out` collects stdout. */
function fakeIo(body: string) {
  const bytes = Buffer.from(body, "utf8");
  let at = 0;
  const out: string[] = [];

  const io: HookIo = {
    readChunk: () => {
      if (at >= bytes.length) return null;
      const chunk = bytes.subarray(at, at + 100);
      at += 100;

      return chunk;
    },
    write: (text) => {
      out.push(text);
    },
  };

  return { io, out };
}

/** Runs `main`, capturing what it writes to stderr. */
function run(argv: string[], body = "") {
  const { io, out } = fakeIo(body);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const code = main(argv, io);
  const stderr = err.mock.calls.map((c) => String(c[0])).join("");

  return { code, stderr, stdout: out.join("") };
}

const KINDS = [
  ["plan", VALID_PLAN, ".repo/plans"],
  ["roadmap", DRAFT_ROADMAP, ".repo/roadmaps"],
  ["handoff", VALID_HANDOFF, ".repo/handoffs"],
  ["implementation", VALID_IMPL, ".repo/implementations"],
  ["tmp", VALID_TMP, ".repo/scratch"],
] as const;

describe("repo persist <kind>", () => {
  it.each(KINDS)("saves a valid %s body under --workspace and prints its four keys", (kind, body, dir) => {
    const ws = tmpDir();
    const r = run([kind, "--workspace", ws], body);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.endsWith("\n")).toBe(true);
    const json = parsePersistCliJson(r.stdout);
    expect(Object.keys(json).toSorted(byCodeUnit)).toStrictEqual(["absPath", "filename", "path", "serial"]);
    expect(json.path).toBe(`${dir}/${json.filename}`);
    expect(json.absPath).toBe(path.join(ws, json.path));
    expect(fs.existsSync(json.absPath)).toBe(true);
  });

  it("takes the body from stdin chunks past the first read", () => {
    expect(VALID_HANDOFF.length).toBeGreaterThan(300);
    const ws = tmpDir();
    const r = run(["handoff", "--workspace", ws], VALID_HANDOFF);
    expect(fs.readFileSync(parsePersistCliJson(r.stdout).absPath, "utf8")).toContain("sync skills to hosts");
  });
});

describe("repo persist root", () => {
  it("saves under the repo root of the working directory without --workspace", () => {
    const root = tmpDir();
    execFileSync("git", ["init", "-q"], { cwd: root });
    const sub = path.join(root, "packages/a");
    fs.mkdirSync(sub, { recursive: true });
    vi.stubEnv("GROK_WORKSPACE_ROOT", "");
    vi.stubEnv("CLAUDE_PROJECT_DIR", "");
    vi.spyOn(process, "cwd").mockReturnValue(sub);
    const r = run(["handoff"], VALID_HANDOFF);
    expect(r.code, r.stderr).toBe(0);
    const json = parsePersistCliJson(r.stdout);
    expect(path.dirname(json.absPath)).toBe(path.join(root, ".repo/handoffs"));
    expect(fs.existsSync(path.join(sub, ".tmp"))).toBe(false);
  });
});

describe("repo persist errors", () => {
  it("exits 1 with the saver's message on an invalid body and writes nothing", () => {
    const ws = tmpDir();
    const r = run(["tmp", "--workspace", ws], "no name line\n");
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("missing TMP_NAME\n");
    expect(fs.existsSync(path.join(ws, ".tmp"))).toBe(false);
  });

  it("exits 1 with the saver's reasons for an empty body", () => {
    const r = run(["plan", "--workspace", tmpDir()], "");
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/\S\n$/);
  });

  it("prints a thrown value that is not an Error as text", () => {
    const io: HookIo = {
      readChunk: () => {
        throw "stdin gone";
      },
      write: () => {},
    };

    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(main(["tmp"], io)).toBe(1);
    expect(err).toHaveBeenCalledWith("stdin gone\n");
  });
});

describe("repo persist thrown errors", () => {
  it("exits 1 with the thrown message when the workspace cannot be written", () => {
    const ws = tmpDir();
    const file = path.join(ws, "file");
    fs.writeFileSync(file, "");
    const r = run(["handoff", "--workspace", file], VALID_HANDOFF);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr.length).toBeGreaterThan(1);
  });
});

describe("repo persist unknown kind", () => {
  it("exits 1 naming the kinds for an unknown kind", () => {
    const r = run(["nope"], VALID_HANDOFF);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe('repo persist: unknown kind "nope"; use plan, roadmap, handoff, implementation or tmp\n');
  });

  it("does not take an Object.prototype name for a kind", () => {
    const r = run(["constructor"], "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unknown kind "constructor"');
  });
});

describe("repo persist usage", () => {
  it("exits 1 with a usage line when no kind is given", () => {
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("repo persist: missing kind; use plan, roadmap, handoff, implementation or tmp\n");
  });

  it("takes no arguments as no kind", () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(main()).toBe(1);
    expect(err).toHaveBeenCalledWith("repo persist: missing kind; use plan, roadmap, handoff, implementation or tmp\n");
  });
});

describe("repo persist spawned", () => {
  it("is the command a spawned `bun bin/repo.ts persist handoff` runs", () => {
    const r = runPersistCli("handoff", VALID_HANDOFF);
    track(r.cwd);
    expect(r.status, r.stderr).toBe(0);
    const json = r.json ?? { absPath: "", path: "" };
    expect(json.absPath).toBe(path.join(r.ws, json.path));
    expect(fs.existsSync(json.absPath)).toBe(true);

    const bad = spawnSync("bun", [path.join(import.meta.dirname, "../../bin/repo.ts"), "persist", "nope"], {
      encoding: "utf8",
    });

    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('unknown kind "nope"');
  });
});
