import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import {
  callAt,
  freshToken,
  jsonRes,
  plantHome,
  readObject,
  sentForm,
  storePath,
  stubFetch,
  withIo,
  writeJson,
} from "./__fixtures__/google-workspace-kit.ts";
import { accountContext, persistToken, tokenStorePath } from "./google-workspace-account.ts";
import { accessToken } from "./google-workspace-auth.ts";
import { main } from "./google-workspace.ts";

useTempDirs();

const ADC = [".config", "gcloud", "application_default_credentials.json"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function whoamiErrors() {
  const { code, errs } = await withIo(() => main(["whoami"]));

  return `${code}:${errs}`;
}

it("lookup: skips a store file without a refresh token and an ADC file without a client id", async () => {
  const home = plantHome("ws-skip-");
  writeJson(storePath(home), { client_id: "cid", refresh_token: "" });
  writeJson(path.join(home, ...ADC), { client_id: "", refresh_token: "rt", type: "authorized_user" });
  expect(await whoamiErrors()).toMatch(/^1:.*not logged in/);
});

it("lookup: ignores an ADC file that is not an authorized user", async () => {
  const home = plantHome("ws-adc-svc-");
  writeJson(path.join(home, ...ADC), { type: "service_account", ...freshToken() });
  expect(await whoamiErrors()).toMatch(/^1:.*not logged in/);
});

it("lookup: ignores a clasp file whose default token has no refresh token", async () => {
  const home = plantHome("ws-clasp-none-");
  writeJson(path.join(home, ".clasprc.json"), { tokens: { default: { access_token: "x" } } });
  expect(await whoamiErrors()).toMatch(/^1:.*not logged in/);
});

it("lookup: uses the cached access token while it is fresh", async () => {
  const home = plantHome("ws-cached-");
  writeJson(storePath(home), freshToken());
  const calls = stubFetch(() => jsonRes({}, 500));
  await expect(accessToken()).resolves.toBe("at");
  expect(calls).toHaveLength(0);
});

it("lookup: keeps each account's tokens under the home", () => {
  const home = plantHome("ws-path-");
  expect(tokenStorePath(accountContext("work", home))).toBe(storePath(home, "work"));
});

it("lookup: treats an empty or blank account as the default", () => {
  expect(accountContext("").id).toBe("default");
  expect(accountContext("   ").id).toBe("default");
  expect(accountContext(" work ").id).toBe("work");
});

it("refresh: sends the stored client and saves the reply's own expiry date", async () => {
  const home = plantHome("ws-refresh-exp-");
  writeJson(storePath(home), { ...freshToken(), access_token: "old", expiry_date: 1 });
  const calls = stubFetch(() => jsonRes({ access_token: "new", expiry_date: 4_000_000_000_000 }));
  await expect(accessToken()).resolves.toBe("new");
  expect(sentForm(calls).get("refresh_token")).toBe("rt");
  expect(sentForm(calls).get("client_secret")).toBe("cs");
  expect(readObject(storePath(home)).expiry_date).toBe(4_000_000_000_000);
});

it("refresh: defaults the lifetime to an hour and the secret to empty", async () => {
  const home = plantHome("ws-refresh-def-");
  const { client_secret: _drop, ...noSecret } = freshToken();
  writeJson(storePath(home), { ...noSecret, access_token: "", expiry_date: 1 });
  const calls = stubFetch(() => jsonRes({ access_token: "new" }));
  const before = Date.now();
  await accessToken();
  expect(sentForm(calls).get("client_secret")).toBe("");
  expect(Number(readObject(storePath(home)).expiry_date)).toBeGreaterThanOrEqual(before + 3_600_000);
});

it("refresh: reports the server's error text, its code, or a default", async () => {
  const home = plantHome("ws-refresh-err-");
  writeJson(storePath(home), { ...freshToken(), expiry_date: 1 });
  stubFetch(() => jsonRes({ error_description: "revoked" }, 400));
  await expect(accessToken()).rejects.toThrow("revoked");
  stubFetch(() => jsonRes({ error: "invalid_grant" }, 400));
  await expect(accessToken()).rejects.toThrow("invalid_grant");
  stubFetch(() => jsonRes({}, 400));
  await expect(accessToken()).rejects.toThrow("token refresh failed");
});

it("refresh: writes a refreshed clasp token back into the clasp file", async () => {
  const home = plantHome("ws-refresh-clasp-");
  const file = path.join(home, ".clasprc.json");
  const stale = { access_token: "old", client_id: "cid", expiry_date: 1, refresh_token: "rt" };
  writeJson(file, { keep: 1, tokens: { default: stale } });
  stubFetch(() => jsonRes({ access_token: "new", expires_in: 100 }));
  await expect(accessToken()).resolves.toBe("new");
  const saved = readObject(file);
  expect(saved.keep).toBe(1);
  expect(JSON.stringify(saved.tokens)).toContain('"access_token":"new"');
  expect(JSON.stringify(saved)).not.toMatch(/sourcePath|isClasprc/);
});

it("refresh: writes a clasp token into a fresh clasp file when its file holds no JSON object", () => {
  const home = plantHome("ws-clasp-gone-");
  const file = path.join(home, ".clasprc.json");
  writeJson(file, "not an object");
  const token = { client_id: "cid", isClasprc: true, refresh_token: "rt", sourcePath: file } as const;
  persistToken(accountContext(undefined, home), token);
  expect(readObject(file)).toStrictEqual({ tokens: { default: { client_id: "cid", refresh_token: "rt" } } });
});

it("refresh: sends an empty client id when the clasp file has none", async () => {
  const home = plantHome("ws-clasp-noid-");
  writeJson(path.join(home, ".clasprc.json"), { tokens: { default: { refresh_token: "rt" } } });
  const calls = stubFetch(() => jsonRes({ access_token: "new" }));
  await accessToken();
  expect(callAt(calls, 0).url).toContain("oauth2.googleapis.com/token");
  expect(sentForm(calls).get("client_id")).toBe("");
});

it("refresh: saves a refreshed ADC token into the account store, not the gcloud file", async () => {
  const home = plantHome("ws-refresh-adc-");
  const adc = path.join(home, ...ADC);
  writeJson(adc, { type: "authorized_user", ...freshToken(), access_token: "old", expiry_date: 1 });
  stubFetch(() => jsonRes({ access_token: "new", expires_in: 100 }));
  await accessToken();
  expect(readObject(storePath(home)).access_token).toBe("new");
  expect(readObject(adc).access_token).toBe("old");
});
