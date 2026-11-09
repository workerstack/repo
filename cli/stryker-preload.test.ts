import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { spawnSync } from "./spawn.ts";
import { toolEnv } from "./scripts/lint.ts";
import { childEnv } from "./env.ts";

const PRELOAD = path.join(import.meta.dirname, "stryker-preload.ts");
const THROWS = "First argument must be an Error object";
// Babel's stack rewriter wraps the native hook; follow-redirects' CustomError captures a stack on a non-Error.
const REPRO = `
const orig = Error.prepareStackTrace;
Error.prepareStackTrace = (e, t) => (orig ? orig(e, t) : "");
function C() { Error.captureStackTrace(this, C); }
C.prototype = new Error();
new C();
`;
let dir = "";

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function repro(preload: boolean) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "stryker-preload-"));
  const file = path.join(dir, "repro.ts");
  fs.writeFileSync(file, REPRO);
  const args = preload ? ["--preload", PRELOAD, file] : [file];
  const run = spawnSync(process.execPath, args, { encoding: "utf8", env: toolEnv(childEnv()) });
  return { code: run.status, text: `${run.stdout}${run.stderr}` };
}

it("bun still throws on a non-Error that captures a stack; delete cli/stryker-preload.ts and its --preload once it does not", () => {
  const bare = repro(false);
  expect(bare.text).toContain(THROWS);
  expect(bare.code).not.toBe(0);
});

it("the preload clears the native hook, so the same code runs", () => {
  expect(repro(true)).toEqual({ code: 0, text: "" });
});

it("sets prepareStackTrace to undefined when loaded", async () => {
  const before = Error.prepareStackTrace;
  try {
    await import("./stryker-preload.ts");
    expect(Error.prepareStackTrace).toBeUndefined();
  } finally {
    Error.prepareStackTrace = before;
  }
});
