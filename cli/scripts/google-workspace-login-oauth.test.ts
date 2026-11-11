import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import {
  type Spawned,
  browser,
  freshToken,
  jsonRes,
  plantCreds,
  plantHome,
  readObject,
  sentForm,
  storePath,
  stubFetch,
  withIo,
  writeJson,
} from "./__fixtures__/google-workspace-kit.ts";
import { accountContext } from "./google-workspace-account.ts";
import { loginLoopback } from "./google-workspace-auth.ts";
import { main } from "./google-workspace.ts";

useTempDirs();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("oauth login: exchanges the browser's code and stores the tokens", async () => {
  const home = plantHome("ws-login-ok-");
  const creds = plantCreds(home);
  const seen: Spawned[] = [];
  const calls = stubFetch(() => jsonRes({ access_token: "at1", expires_in: 100, refresh_token: "rt1" }));
  const r = await withIo(() => main(["login", "--creds", creds], browser("code=abc", seen)));
  expect(r.code).toBe(0);
  expect(r.logs).toContain("logged in");
  expect(r.logs).toContain(storePath(home));
  expect(seen).toHaveLength(1);
  expect(sentForm(calls).get("code")).toBe("abc");
  expect(sentForm(calls).get("client_secret")).toBe("cs");
  expect(sentForm(calls).get("grant_type")).toBe("authorization_code");
  expect(readObject(storePath(home))).toMatchObject({
    access_token: "at1",
    client_id: "cid",
    refresh_token: "rt1",
    type: "authorized_user",
  });
});

it("oauth login: reads a web client and keeps the old refresh token when none is returned", async () => {
  const home = plantHome("ws-login-web-");
  const creds = path.join(home, "oauth.json");
  writeJson(creds, { web: { client_id: "wid" } });
  writeJson(storePath(home), { ...freshToken(), client_id: "wid", refresh_token: "old-rt" });
  const calls = stubFetch(() => jsonRes({ access_token: "at2" }));
  const before = Date.now();
  await loginLoopback(creds, accountContext("default", home), browser("code=zzz"));
  expect(sentForm(calls).get("client_secret")).toBe("");
  const saved = readObject(storePath(home));
  expect(saved.refresh_token).toBe("old-rt");
  expect(Number(saved.expiry_date)).toBeGreaterThanOrEqual(before + 3_600_000);
});

it("oauth login: uses the default creds file under the account dir", async () => {
  const home = plantHome("ws-login-def-");
  const file = path.join(home, ".workerstack", "workspace", "default", "google-oauth.json");
  writeJson(file, { installed: { client_id: "cid" } });
  stubFetch(() => jsonRes({ access_token: "at", refresh_token: "rt" }));
  const r = await withIo(() => main(["login"], browser("code=abc")));
  expect(r.code).toBe(0);
  expect(readObject(storePath(home)).access_token).toBe("at");
});

it("oauth login: rejects an OAuth JSON without a client id", async () => {
  const home = plantHome("ws-login-noid-");
  const creds = path.join(home, "oauth.json");
  writeJson(creds, { installed: {} });
  const r = await withIo(() => main(["login", "--creds", creds], () => ({ status: 1 })));
  expect(r.code).toBe(1);
  expect(r.errs).toMatch(/needs installed\.client_id/);
});

it("oauth login: fails with the denial the browser reports, or a missing code", async () => {
  const creds = plantCreds(plantHome("ws-login-deny-"));
  const denied = await withIo(() => main(["login", "--creds", creds], browser("error=access_denied")));
  expect(denied.code).toBe(1);
  expect(denied.errs).toContain("access_denied");
  const empty = await withIo(() => main(["login", "--creds", creds], browser("x=1")));
  expect(empty.code).toBe(1);
  expect(empty.errs).toContain("missing code");
});

async function exchangeFailing(creds: string, reply: Record<string, unknown>) {
  stubFetch(() => jsonRes(reply, 400));
  const r = await withIo(() => main(["login", "--creds", creds], browser("code=c")));
  return r.errs;
}

it("oauth login: reports why the token exchange failed and stores nothing", async () => {
  const home = plantHome("ws-login-xchg-");
  const creds = plantCreds(home);
  expect(await exchangeFailing(creds, { error_description: "bad code" })).toContain("bad code");
  expect(await exchangeFailing(creds, { error: "invalid_grant" })).toContain("invalid_grant");
  expect(await exchangeFailing(creds, {})).toContain("token exchange failed");
  expect(fs.existsSync(storePath(home))).toBe(false);
});

it("oauth login: gives up when the browser never answers", async () => {
  const creds = plantCreds(plantHome("ws-login-slow-"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const done = withIo(() => main(["login", "--creds", creds], () => ({ status: 0 })));
  await vi.advanceTimersByTimeAsync(180_000);
  const r = await done;
  expect(r.code).toBe(1);
  expect(r.errs).toContain("login timed out");
});
