import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { captureIo, cleanSetup, desktopOauth, plant, readJsonAt, writeAt } from "./fixtures/setup-kit.ts";
import { oauthWritePath } from "./setup-files.ts";
import { setupGoogleWorkspace } from "./setup-google-workspace.ts";
import type { SetupIo } from "./setup.types.ts";

afterEach(cleanSetup);

const body = JSON.stringify(desktopOauth);
function noLogin() {
  return Promise.resolve();
}

it("setupGoogleWorkspace names the account from --account and accepts --json", async () => {
  const home = plant("setup-gw-acct-");
  const src = writeAt(path.join(home, "c.json"), body);
  const logins: string[] = [];
  function loginFn(dest: string) {
    return (logins.push(dest), Promise.resolve());
  }
  const r = await setupGoogleWorkspace({ flags: { account: "work", json: src }, home, io: captureIo(), loginFn });
  expect(r.dest).toBe(oauthWritePath(home, "work"));
  expect(logins).toStrictEqual([r.dest]);
  expect(r.tokens).toBe(path.join(home, ".workerstack", "workspace", "work", "tokens.json"));
});

it("setupGoogleWorkspace reuses an installed client when no creds are passed", async () => {
  const home = plant("setup-gw-reuse-");
  const dest = writeAt(oauthWritePath(home, "default"), body);
  const io = captureIo();
  await setupGoogleWorkspace({ home, io, loginFn: noLogin });
  expect(io.logs).toContain(`oauth ${dest}`);
});

it("setupGoogleWorkspace without creds or an installed client names the flag", async () => {
  const home = plant("setup-gw-none-");
  await expect(setupGoogleWorkspace({ home, io: captureIo(), loginFn: noLogin })).rejects.toThrow(/need --creds PATH/);
});

it("setupGoogleWorkspace falls back to the real loopback login, which rejects a client without an id", async () => {
  const home = plant("setup-gw-real-");
  writeAt(oauthWritePath(home, "default"), "{}");
  await expect(setupGoogleWorkspace({ home, io: captureIo() })).rejects.toThrow(/installed\.client_id/);
});

it("setupGoogleWorkspace with no context fails on the stubbed home", async () => {
  const home = plant("setup-gw-default-", true);
  await expect(setupGoogleWorkspace()).rejects.toThrow(/need --creds PATH/);
  expect(fs.existsSync(path.join(home, ".workerstack"))).toBe(true);
});

function walker(texts: Record<string, string>, { withText = true }: { withText?: boolean } = {}) {
  const asked: string[] = [];
  const io: SetupIo & { logs: string[]; asked: string[] } = { ...captureIo(), asked };
  io.confirm = (o) => (asked.push(o.message), Promise.resolve(true));
  if (withText) {
    io.text = (o) => (
      asked.push(o.message),
      Promise.resolve(texts[o.message.split(" ")[0] ?? ""] ?? o.defaultValue ?? "")
    );
  }
  return io;
}

it("setupGoogleWorkspace keeps the typed project id, or the flag when the answer is blank", async () => {
  const home = plant("setup-gw-proj-");
  const src = writeAt(path.join(home, "c.json"), body);
  const typed: string[] = [];
  const io = walker({ Path: src, Project: "" });
  await setupGoogleWorkspace({
    flags: { project: "flag-proj" },
    home,
    interactive: true,
    io,
    loginFn: noLogin,
    openUrlFn: (u) => typed.push(u),
  });
  expect(typed.filter((u) => u.includes("project=flag-proj")).length).toBe(3);
});

/** Runs the terminal setup over a home whose Downloads holds a client file; whether the OAuth file was installed. */
async function installsDownload(prefix: string, makeIo: () => SetupIo): Promise<boolean> {
  const home = plant(prefix);
  writeAt(path.join(home, "Downloads", "client_secret_1.json"), body);
  await setupGoogleWorkspace({ home, interactive: true, io: makeIo(), loginFn: noLogin, openUrlFn: () => 0 });
  return fs.existsSync(oauthWritePath(home, "default"));
}

it("setupGoogleWorkspace uses the newest download when the path prompt takes its default", async () => {
  expect(await installsDownload("setup-gw-found-", () => walker({}))).toBe(true);
});

it("setupGoogleWorkspace on an io without confirm or text takes the download", async () => {
  expect(await installsDownload("setup-gw-bare-io-", captureIo)).toBe(true);
});

it("setupGoogleWorkspace fails when the terminal walk ends with no JSON", async () => {
  const home = plant("setup-gw-nojson-");
  const io = walker({}, { withText: false });
  const ask = setupGoogleWorkspace({ home, interactive: true, io, loginFn: noLogin, openUrlFn: () => 0 });
  await expect(ask).rejects.toThrow("need path to Desktop OAuth JSON");
});

it("copies --creds and calls login", async () => {
  const home = plant("setup-gw-");
  const src = path.join(home, "client_secret.json");
  fs.writeFileSync(src, JSON.stringify(desktopOauth));
  const io = captureIo();
  const logins: string[] = [];
  const r = await setupGoogleWorkspace({
    flags: { creds: src },
    home,
    io,
    loginFn: (p: string) => {
      logins.push(p);
      return Promise.resolve();
    },
  });
  expect(r.ok).toBe(true);
  expect(logins).toStrictEqual([path.join(home, ".workerstack", "workspace", "default", "google-oauth.json")]);
  const saved = readJsonAt(path.join(home, ".workerstack", "workspace", "default", "google-oauth.json"));
  expect(saved.installed?.client_id).toContain("cid");
});

it("lands the tokens under the home it was given and writes nothing under the real home", async () => {
  const home = plant("setup-gw-home-");
  const src = path.join(home, "client_secret.json");
  fs.writeFileSync(src, JSON.stringify(desktopOauth));
  const realTokens = path.join(os.homedir(), ".workerstack", "workspace", "default", "tokens.json");
  function mtime(): number | null {
    return fs.existsSync(realTokens) ? fs.statSync(realTokens).mtimeMs : null;
  }
  const before = mtime();
  const r = await setupGoogleWorkspace({
    flags: { creds: src },
    home,
    io: captureIo(),
    loginFn: (_dest: string, loginHome: string) => {
      writeAt(path.join(loginHome, ".workerstack", "workspace", "default", "tokens.json"), "{}");
      return Promise.resolve();
    },
  });
  expect(r.tokens).toBe(path.join(home, ".workerstack", "workspace", "default", "tokens.json"));
  expect(fs.existsSync(r.tokens)).toBe(true);
  expect(mtime()).toBe(before);
});

it("interactive walk opens console URLs then installs JSON", async () => {
  const home = plant("setup-gw-tty-");
  const src = path.join(home, "dl.json");
  fs.writeFileSync(src, JSON.stringify(desktopOauth));
  const opened: string[] = [];
  const io = {
    ...captureIo(),
    confirm: () => Promise.resolve(true),
    text: (opts: { message?: string }) => Promise.resolve((opts.message ?? "").includes("Project ID") ? "proj-1" : src),
  };
  await setupGoogleWorkspace({
    flags: {},
    home,
    interactive: true,
    io,
    loginFn: noLogin,
    openUrlFn: (u: string) => opened.push(u),
  });
  expect(opened[0]).toMatch(/projectcreate/);
  expect(opened.some((u) => u.includes("project=proj-1"))).toBe(true);
  expect(opened.some((u) => u.includes("enableapi"))).toBe(true);
  expect(opened.some((u) => u.includes("clients/create"))).toBe(true);
  expect(fs.existsSync(path.join(home, ".workerstack", "workspace", "default", "google-oauth.json"))).toBe(true);
});
