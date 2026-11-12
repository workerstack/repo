/**
 * env-migrate-parity.ts's `hashEnvs(root, targets, { env, timeout? })` over files in a temp folder:
 *
 *   targets: { rel: string; name: string }[]   // a file, relative to root, and the export to hash
 *   → { ok: true; hashes: { [view]: { [key]: sha256 } }[] } | { ok: false; rel: string; reason: string }
 *
 * A load that throws names its file and the class of what it threw, never the message; a child that prints no result,
 * prints one that does not parse, or runs over its time names every file it read and a fixed reason.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { SPAWN } from "../__fixtures__/env-repo.ts";
import { childEnv } from "../env.ts";
import { PARITY_SENTINEL } from "./env-command.constants.ts";
import { hashEnvs } from "./env-migrate-parity.ts";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "env-parity-"));
const ENV = "export const e = { global: { A: 'a' }, local: {}, dev: { B: 'b' }, prod: {} };\n";

const FILES = {
  "exits.ts": "process.exit(0);\n",
  "garbled.ts": `process.stdout.write(${JSON.stringify(`\n${PARITY_SENTINEL}{\n`)});\nprocess.exit(0);\n`,
  "hangs.ts": "await new Promise(() => setInterval(() => undefined, 1000));\n",
  "ok.ts": ENV,
  "throws.ts": 'throw new TypeError("fake-message-that-holds-a-value");\n',
};

for (const [rel, text] of Object.entries(FILES)) fs.writeFileSync(path.join(ROOT, rel), text);

afterAll(() => {
  fs.rmSync(ROOT, { force: true, recursive: true });
});

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("hashEnvs, a read", () => {
  it("hashes every value of each view", SPAWN, async () => {
    expect(await hashEnvs(ROOT, [{ name: "e", rel: "ok.ts" }], { env: childEnv() })).toStrictEqual({
      hashes: [{ dev: { B: sha("b") }, global: { A: sha("a") }, local: {}, prod: {} }],
      ok: true,
    });
  });

  it("names the file whose load threw and the class it threw, not its message", SPAWN, async () => {
    const targets = [
      { name: "e", rel: "ok.ts" },
      { name: "e", rel: "throws.ts" },
    ];

    expect(await hashEnvs(ROOT, targets, { env: childEnv() })).toStrictEqual({
      ok: false,
      reason: "TypeError",
      rel: "throws.ts",
    });
  });
});

describe("hashEnvs, a child with no result", () => {
  it.each([
    ["exits.ts", "the check printed no result"],
    ["garbled.ts", "the check printed a result that does not parse"],
  ])("fails %s on a fixed line", SPAWN, async (rel, reason) => {
    const targets = [
      { name: "e", rel: "ok.ts" },
      { name: "e", rel },
    ];

    expect(await hashEnvs(ROOT, targets, { env: childEnv() })).toStrictEqual({
      ok: false,
      reason,
      rel: `ok.ts, ${rel}`,
    });
  });

  it("kills a child that runs over its time", SPAWN, async () => {
    const got = await hashEnvs(ROOT, [{ name: "e", rel: "hangs.ts" }], { env: childEnv(), timeout: 1000 });
    expect(got).toStrictEqual({ ok: false, reason: "the check took over 1s", rel: "hangs.ts" });
  });
});
