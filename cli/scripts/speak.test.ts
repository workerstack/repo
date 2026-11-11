import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import { collector, failRes, fetchReturning, plantDir } from "./fixtures/speak-kit.ts";
import { OPENAI_VOICES, USAGE } from "./speak.constants.ts";
import { main } from "./speak.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoCli = path.join(here, "..", "..", "bin", "repo.ts");
const noKeys = { ELEVENLABS_API_KEY: "", OPENAI_API_KEY: "", SPEAK_PROVIDER: "" };

it("main: usage on unknown verb", async () => {
  const c = collector();
  expect(await main(["nope"], { env: {}, home: plantDir("speak-u-"), log: c.log })).toBe(1);
  expect(c.errs.join("\n")).toContain(USAGE);
});

it("main: whoami without a key fails and does not print a key", async () => {
  const c = collector();
  expect(await main(["whoami"], { env: {}, home: plantDir("speak-who-"), log: c.log })).toBe(1);
  const all = `${c.logs.join("\n")}\n${c.errs.join("\n")}`;
  expect(all).toMatch(/ELEVENLABS_API_KEY|OPENAI_API_KEY|speak\.json/);
  expect(all).toMatch(/setup: bun repo setup speak/);
  expect(all).not.toMatch(/sk_/);
});

it("main: 401 does not dump JSON", async () => {
  const c = collector();
  const fetchFn = fetchReturning(failRes(401, '{"detail":{"type":"authentication_error","message":"invalid"}}'));
  const opts = { env: { ELEVENLABS_API_KEY: "sk_bad" }, fetchFn, home: plantDir("speak-401-"), log: c.log };
  expect(await main(["say", "--text", "hi"], opts)).toBe(1);
  const msg = c.errs.join("\n");
  expect(msg).toMatch(/setup: bun repo setup speak/);
  expect(msg).not.toMatch(/authentication_error/);
  expect(msg).not.toContain("sk_bad");
});

it("main: scoped elevenlabs whoami is ok without user_read", async () => {
  const c = collector();
  const fetchFn = fetchReturning(
    failRes(
      401,
      '{"detail":{"type":"authentication_error","code":"unauthorized","message":"missing the permission user_read","status":"missing_permissions"}}',
    ),
  );
  const opts = { env: { ELEVENLABS_API_KEY: "sk_scoped" }, fetchFn, home: plantDir("speak-scope-"), log: c.log };
  expect(await main(["whoami"], opts)).toBe(0);
  expect(c.logs.join("\n")).toMatch(/elevenlabs\s+ok/);
  expect(c.logs.join("\n")).not.toMatch(/authentication_error/);
});

it("main: openai voices are local", async () => {
  const c = collector();
  const opts = { env: { OPENAI_API_KEY: "sk_oa" }, home: plantDir("speak-v-"), log: c.log };
  expect(await main(["voices", "--provider", "openai"], opts)).toBe(0);
  expect(c.logs.join("\n")).toContain(OPENAI_VOICES[0]);
});

it("speak cli: no args prints usage and exits 1", () => {
  const r = spawnSync(bunPath(), [repoCli, "speak"], { encoding: "utf8", env: childEnv(noKeys), timeout: 15_000 });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("usage: speak");
});

it("speak cli: whoami without a key exits non-zero and does not print a key", () => {
  const env = childEnv({ HOME: plantDir("speak-cli-"), ...noKeys });
  const r = spawnSync(bunPath(), [repoCli, "speak", "whoami"], { encoding: "utf8", env, timeout: 15_000 });
  expect(r.status).not.toBe(0);
  const out = `${r.stdout}${r.stderr}`;
  expect(out).not.toMatch(/sk_/);
  expect(out).toMatch(/ELEVENLABS_API_KEY|OPENAI_API_KEY|speak\.json/);
  expect(out).toMatch(/setup: bun repo setup speak/);
});
