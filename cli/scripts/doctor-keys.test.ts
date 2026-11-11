import { expect, it } from "vitest";

import { enablePacks, homeWith, linuxRun, runDoctor, tmp, toolsCwd } from "./fixtures/doctor-kit.ts";

const ACCOUNT = ".workerstack/workspace/default";

it("google-workspace with no credentials is optional missing", () => {
  const { cwd, bin } = toolsCwd("doc-ws-");
  enablePacks(["google-workspace"]);
  const missing = linuxRun(cwd, bin);
  expect(missing.code).toBe(0);
  expect(missing.stdout).toMatch(/google-workspace\s+missing \(optional\)/);
});

it("google-workspace oauth and tokens are optional ok and do not echo secrets", () => {
  const { cwd, bin } = toolsCwd("doc-ws-");
  enablePacks(["google-workspace"]);
  const oauthSecret = "oauth-client-secret-do-not-print";
  const oauthHome = homeWith("doc-ws-oauth-", {
    [`${ACCOUNT}/google-oauth.json`]: { installed: { client_id: "cid", client_secret: oauthSecret } },
  });
  const oauth = linuxRun(cwd, bin, { home: oauthHome });
  expect(oauth.code).toBe(0);
  expect(oauth.stdout).toMatch(/google-workspace\s+ok\s+oauth/);
  expect(oauth.stdout).not.toContain(oauthSecret);
  expect(oauth.stdout).not.toContain("cid");
  expect(oauth.stdout).not.toMatch(/google-workspace\s+missing/);

  const refresh = "refresh-token-secret";
  const tokHome = homeWith("doc-ws-tok-", {
    [`${ACCOUNT}/tokens.json`]: { client_id: "tok-cid", refresh_token: refresh },
  });
  const tokens = linuxRun(cwd, bin, { home: tokHome });
  expect(tokens.stdout).toMatch(/google-workspace\s+ok\s+tokens/);
  expect(tokens.stdout).not.toContain(refresh);
  expect(tokens.stdout).not.toContain("tok-cid");
});

it("google-workspace named account, adc and clasprc are optional ok and do not echo secrets", () => {
  const { cwd, bin } = toolsCwd("doc-ws-");
  enablePacks(["google-workspace"]);
  const namedHome = homeWith("doc-ws-named-", {
    ".workerstack/workspace/work/google-oauth.json": {
      installed: { client_id: "work-cid", client_secret: "work-secret" },
    },
    ".workerstack/workspace/work/tokens.json": { refresh_token: "work-refresh" },
  });
  const named = linuxRun(cwd, bin, { home: namedHome });
  expect(named.stdout).toMatch(/google-workspace\s+ok\s+oauth,tokens/);
  expect(named.stdout).not.toContain("work-secret");
  expect(named.stdout).not.toContain("work-refresh");
  expect(named.stdout).not.toContain("work-cid");

  const adcHome = homeWith("doc-ws-adc-", {
    ".config/gcloud/application_default_credentials.json": { refresh_token: "adc-refresh", type: "authorized_user" },
  });
  const adc = linuxRun(cwd, bin, { home: adcHome });
  expect(adc.stdout).toMatch(/google-workspace\s+ok\s+adc/);
  expect(adc.stdout).not.toContain("adc-refresh");

  const claspHome = homeWith("doc-ws-clasprc-", {
    ".clasprc.json": { tokens: { default: { refresh_token: "clasp-refresh" } } },
  });
  const clasprc = linuxRun(cwd, bin, { home: claspHome });
  expect(clasprc.stdout).toMatch(/google-workspace\s+ok\s+clasprc/);
  expect(clasprc.stdout).not.toContain("clasp-refresh");
});

it("speak dummy key is optional ok and does not echo the secret", () => {
  const { cwd, bin } = toolsCwd("doc-speak-");
  enablePacks(["speak"]);
  const secret = "sk_secret_do_not_print";
  const r = linuxRun(cwd, bin, { env: { ELEVENLABS_API_KEY: secret } });
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/speak\s+ok\s+elevenlabs/);
  expect(r.stdout).not.toContain(secret);
  expect(r.stdout).not.toMatch(/speak\s+missing/);
});

it("speak openai key and speak.json config do not print secrets", () => {
  const { cwd, bin } = toolsCwd("doc-speak-oa-");
  enablePacks(["speak"]);
  const home = homeWith("doc-speak-home-", { ".workerstack/speak.json": { openai: { apiKey: "sk_file_secret" } } });
  const oa = linuxRun(cwd, bin, { env: { OPENAI_API_KEY: "sk_oa_secret" } });
  expect(oa.stdout).toMatch(/speak\s+ok\s+openai/);
  expect(oa.stdout).not.toContain("sk_oa_secret");
  const file = linuxRun(cwd, bin, { env: {}, home });
  expect(file.stdout).toMatch(/speak\s+ok\s+config/);
  expect(file.stdout).not.toContain("sk_file_secret");
});

it("hides optional pack rows when no features file enables them", () => {
  const cwd = tmp("doc-packs-off-");
  const r = runDoctor({ cwd, pathEnv: "", platform: "linux" });
  expect(r.stdout).toMatch(/gh\s+missing \(optional\)/);
  expect(r.stdout).toMatch(/jev\s+missing \(optional\)/);
  expect(r.stdout).not.toMatch(/clasp\s+/);
  expect(r.stdout).not.toMatch(/google-workspace\s+/);
  expect(r.stdout).not.toMatch(/speak\s+/);
  expect(r.stdout).not.toMatch(/ffmpeg\s+/);
  expect(r.stdout).not.toMatch(/whisper-cli\s+/);
});

it("jev env or jev.json is optional ok and does not echo the secret", () => {
  const { cwd, bin } = toolsCwd("doc-jev-");
  const secret = "ts_live_do_not_print";
  const fromEnv = linuxRun(cwd, bin, { env: { TYPESAFE_API_KEY: secret } });
  expect(fromEnv.code).toBe(0);
  expect(fromEnv.stdout).toMatch(/jev\s+ok\s+env/);
  expect(fromEnv.stdout).not.toContain(secret);
  const home = homeWith("doc-jev-home-", { ".workerstack/jev.json": { apiKey: secret } });
  const fromFile = linuxRun(cwd, bin, { env: {}, home });
  expect(fromFile.code).toBe(0);
  expect(fromFile.stdout).toMatch(/jev\s+ok\s+config/);
  expect(fromFile.stdout).not.toContain(secret);
});
