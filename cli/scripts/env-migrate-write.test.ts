/**
 * env-migrate-write.ts's `writeAll(root, plans, proof)` over a file in a temp folder: it writes each plan's text,
 * hashes the new file in a fresh child, and on a difference restores the file and throws
 * `repo env: <rel> <view>.<KEY> differs after migrate; restored <n> files`, a key on one side only differing too. A
 * SIGINT or SIGTERM caught in that window (on the `host` it is given) restores the file, prints
 * `repo env: interrupted by <signal>; restored <n> files; if one still differs, run \`git restore <rels>\`` and exits
 * 130 or 143; once it returns, no listener is left.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SPAWN } from "../__fixtures__/env-repo.ts";
import { NONE_COUNTED } from "../__fixtures__/script-env/edit-kit.ts";
import { childEnv } from "../env.ts";
import { hashEnvs } from "./env-migrate-parity.ts";
import type { Plan } from "./env-migrate-report.ts";
import { guardSignals, writeAll, type Proof } from "./env-migrate-write.ts";

const REL = "x.ts";
const TARGETS = [{ name: "e", rel: REL }];
const BEFORE = "export const e = { global: { A: 'a' }, local: { B: 'b' }, dev: {}, prod: {} };\n";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});

/** A fake signal host: listeners as an EventEmitter keeps them, and each exit code asked for. */
type Host = EventEmitter & { codes: number[]; exit: (code: number) => void };

/** A fresh fake host. */
function fakeHost(): Host {
  const codes: number[] = [];

  return Object.assign(new EventEmitter(), { codes, exit: (code: number) => codes.push(code) });
}

/** A temp root holding BEFORE at REL, the plan that rewrites it to `after`, and the proof against its hashes. */
async function world(after: string): Promise<{ root: string; plan: Plan; proof: Proof; lines: string[]; host: Host }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "env-write-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, REL), BEFORE);
  const run = { env: childEnv() };
  const before = await hashEnvs(root, TARGETS, run);
  const lines: string[] = [];
  const facts = { bindings: ["e"], calls: 1, dollars: [], parents: [] };
  const plan = { before: BEFORE, facts, migrated: { counts: NONE_COUNTED, helpers: [], text: after }, rel: REL };
  const hashes = before.ok ? before.hashes : [];
  const host = fakeHost();
  const proof = { before: hashes, host, run, stderr: (line: string) => lines.push(line), targets: TARGETS };

  return { host, lines, plan, proof, root };
}

describe("writeAll, parity", () => {
  it("keeps the new file when every value reads the same", SPAWN, async () => {
    const after = `// migrated\n${BEFORE}`;
    const { plan, proof, root } = await world(after);
    await writeAll(root, [plan], proof);
    expect(fs.readFileSync(path.join(root, REL), "utf8")).toBe(after);
  });

  it.each([
    ["a global value that differs", BEFORE.replace("A: 'a'", "A: 'z'"), "global.A"],
    ["a key only the new file has", BEFORE.replace("B: 'b'", "B: 'b', C: 'c'"), "local.C"],
    ["a key only the old file had", BEFORE.replace("B: 'b'", ""), "local.B"],
  ])("restores the file on %s", SPAWN, async (_, after, at) => {
    const { plan, proof, root } = await world(after);
    await expect(writeAll(root, [plan], proof)).rejects.toThrow(
      new Error(`repo env: ${REL} ${at} differs after migrate; restored 1 file`),
    );
    expect(fs.readFileSync(path.join(root, REL), "utf8")).toBe(BEFORE);
  });
});

describe("writeAll, a signal", () => {
  it("restores the file, names `git restore`, exits 143 on SIGTERM, and leaves no listener", SPAWN, async () => {
    const { host, lines, plan, proof, root } = await world(`// migrated\n${BEFORE}`);
    const writing = writeAll(root, [plan], proof);
    // The writes are done before the first await: the signal lands while the new file is checked.
    host.emit("SIGTERM");
    await writing;
    expect(fs.readFileSync(path.join(root, REL), "utf8")).toBe(BEFORE);
    expect(lines).toStrictEqual([
      `repo env: interrupted by SIGTERM; restored 1 file; if one still differs, run \`git restore ${REL}\`\n`,
    ]);
    expect(host.codes).toStrictEqual([143]);
    expect(host.eventNames()).toStrictEqual([]);
  });
});

describe("guardSignals", () => {
  it("calls back and exits 130 on SIGINT, until stopped", () => {
    const host = fakeHost();
    const seen: string[] = [];
    const stop = guardSignals(host, (signal) => seen.push(signal));
    host.emit("SIGINT");
    stop();
    host.emit("SIGINT");
    expect([seen, host.codes]).toStrictEqual([["SIGINT"], [130]]);
  });
});
