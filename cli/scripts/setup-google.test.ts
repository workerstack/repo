import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { captureIo, cleanSetup, desktopOauth, plant, writeAt } from "./fixtures/setup-kit.ts";
import { oauthWritePath, setupGoogleWorkspace } from "./setup.ts";
import type { SetupIo } from "./setup.ts";

afterEach(cleanSetup);

const body = JSON.stringify(desktopOauth);
const noLogin = () => Promise.resolve();

it("setupGoogleWorkspace names the account from --account and accepts --json", async () => {
  const home = plant("setup-gw-acct-");
  const src = writeAt(path.join(home, "c.json"), body);
  const logins: string[] = [];
  const loginFn = (dest: string) => (logins.push(dest), Promise.resolve());
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

function walker(texts: Record<string, string>, withText = true) {
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

it("setupGoogleWorkspace uses the newest download when the path prompt takes its default", async () => {
  const home = plant("setup-gw-found-");
  writeAt(path.join(home, "Downloads", "client_secret_1.json"), body);
  const io = walker({});
  await setupGoogleWorkspace({ home, interactive: true, io, loginFn: noLogin, openUrlFn: () => 0 });
  expect(fs.existsSync(oauthWritePath(home, "default"))).toBe(true);
});

it("setupGoogleWorkspace on an io without confirm or text takes the download", async () => {
  const home = plant("setup-gw-bare-io-");
  writeAt(path.join(home, "Downloads", "client_secret_1.json"), body);
  const io = captureIo();
  await setupGoogleWorkspace({ home, interactive: true, io, loginFn: noLogin, openUrlFn: () => 0 });
  expect(fs.existsSync(oauthWritePath(home, "default"))).toBe(true);
});

it("setupGoogleWorkspace fails when the terminal walk ends with no JSON", async () => {
  const home = plant("setup-gw-nojson-");
  const io = walker({}, false);
  const ask = setupGoogleWorkspace({ home, interactive: true, io, loginFn: noLogin, openUrlFn: () => 0 });
  await expect(ask).rejects.toThrow("need path to Desktop OAuth JSON");
});
