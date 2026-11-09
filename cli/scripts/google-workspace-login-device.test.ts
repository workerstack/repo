import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { type SpawnFn, loginLoopback, main, openUrl, setAccount } from "./google-workspace.ts";
import {
  type Spawned,
  jsonRes,
  plantCreds,
  plantHome,
  readObject,
  storePath,
  stubFetch,
  withIo,
} from "./fixtures/google-workspace-kit.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  setAccount("default");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A PATH dir whose `open` and `xdg-open` record their argument instead of opening a browser. */
function plantOpener(): string {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "ws-bin-"));
  dirs.push(bin);
  const record = path.join(bin, "opened.txt");
  for (const name of ["open", "xdg-open"]) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nprintf '%s' "$1" > "${record}"\n`, { mode: 0o755 });
  }
  vi.stubEnv("PATH", bin);
  return record;
}

it("openUrl: opens with open on macOS, cmd start on Windows and xdg-open elsewhere", () => {
  const calls: unknown[][] = [];
  const spawnSyncFn = (...a: unknown[]) => calls.push(a);
  openUrl("https://x", { platform: "darwin", spawnSyncFn });
  openUrl("https://x", { platform: "win32", spawnSyncFn });
  openUrl("https://x", { platform: "linux", spawnSyncFn });
  expect(calls).toEqual([
    ["open", ["https://x"], { stdio: "ignore" }],
    ["cmd", ["/c", "start", "", "https://x"], { stdio: "ignore", windowsVerbatimArguments: true }],
    ["xdg-open", ["https://x"], { stdio: "ignore" }],
  ]);
});

it("gcloud login: runs the application-default login when there is no OAuth JSON", async () => {
  plantHome(dirs, "ws-gcloud-");
  const seen: Spawned[] = [];
  const spawn: SpawnFn = (cmd, args) => {
    seen.push({ cmd, args });
    return { status: 0 };
  };
  const r = await withIo(() => main(["login"], spawn));
  expect(r.code).toBe(0);
  expect(r.logs).toContain("logged in via gcloud ADC");
  expect(seen[0]).toEqual({ cmd: "gcloud", args: ["--version"] });
  expect(seen[1]?.args.slice(0, 3)).toEqual(["auth", "application-default", "login"]);
  expect(seen[1]?.args[3]).toContain("--scopes=https://www.googleapis.com/auth/cloud-platform,");
});

it("gcloud login: fails when gcloud's login fails", async () => {
  plantHome(dirs, "ws-gcloud-fail-");
  const spawn: SpawnFn = (_cmd, args) => ({ status: args[0] === "--version" ? 0 : 2 });
  const r = await withIo(() => main(["login"], spawn));
  expect(r.code).toBe(1);
  expect(r.errs).toContain("gcloud auth application-default login failed");
});

// Windows has no sh stub to plant, so the platform opener cases run elsewhere.
it.skipIf(process.platform === "win32")("platform opener: opens the URL through the default spawn", () => {
  const record = plantOpener();
  openUrl("https://example.test/a");
  expect(fs.readFileSync(record, "utf8")).toBe("https://example.test/a");
});

it.skipIf(process.platform === "win32")("platform opener: login defaults its home and spawn", async () => {
  const record = plantOpener();
  const home = plantHome(dirs, "ws-login-default-");
  stubFetch(() => jsonRes({ access_token: "at", refresh_token: "rt" }));
  const login = loginLoopback(plantCreds(home));
  await vi.waitFor(() => expect(fs.readFileSync(record, "utf8")).toContain("redirect_uri"));
  const redirect = new URL(fs.readFileSync(record, "utf8")).searchParams.get("redirect_uri") ?? "";
  http.get(`${redirect}/?code=abc`, { agent: false }, (res) => res.resume());
  await login;
  expect(readObject(storePath(home)).access_token).toBe("at");
});
