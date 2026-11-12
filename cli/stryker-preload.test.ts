import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { childEnv } from "./env.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import { spawnSync } from "./spawn.ts";

const PRELOAD = path.join(import.meta.dirname, "stryker-preload.ts");
const REMOVE_WHEN_FIXED = "delete cli/stryker-preload.ts and its --preload once it does not";
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

afterEach(() => fs.rmSync(dir, { force: true, recursive: true }));

function repro({ preload }: { preload: boolean }) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "stryker-preload-"));
  const file = path.join(dir, "repro.ts");
  fs.writeFileSync(file, REPRO);
  const args = preload ? ["--preload", PRELOAD, file] : [file];
  const run = spawnSync(process.execPath, args, { encoding: "utf8", env: toolEnv(childEnv()) });

  return { code: run.status, text: `${run.stdout}${run.stderr}` };
}

it(`bun still throws on a non-Error that captures a stack; ${REMOVE_WHEN_FIXED}`, () => {
  const bare = repro({ preload: false });
  expect(bare.text).toContain(THROWS);
  expect(bare.code).not.toBe(0);
});

it("the preload clears the native hook, so the same code runs", () => {
  expect(repro({ preload: true })).toStrictEqual({ code: 0, text: "" });
});

it("sets prepareStackTrace to undefined when loaded", async () => {
  const before = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");

  try {
    await import(PRELOAD);
    expect(Error).toHaveProperty("prepareStackTrace", undefined);
  } finally {
    if (before === undefined) Reflect.deleteProperty(Error, "prepareStackTrace");
    else Object.defineProperty(Error, "prepareStackTrace", before);
  }
});
