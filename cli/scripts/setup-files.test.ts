import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanSetup, desktopOauth, plant, readJsonAt, readSpeakJson, writeAt } from "./fixtures/setup-kit.ts";
import { mergeSpeakJson, oauthWritePath, speakJsonPath, stateHome, writeSecretJson } from "./setup-files.ts";
import { findDownloadedOAuthJson, installOAuthJson, parseDesktopOAuth, workspaceConsoleUrls } from "./setup-oauth.ts";

afterEach(cleanSetup);

// Windows has no owner-only mode: stat reports read-write for everyone, whatever the call asked.
const WIN = process.platform === "win32";
const WIN_MODE = 0o666;

it("stateHome creates ~/.workerstack mode 0700, defaulting to the stubbed home", () => {
  const home = plant("setup-state-", true);
  const dir = stateHome();
  expect(dir).toBe(path.join(home, ".workerstack"));
  expect(fs.statSync(dir).mode & 0o777).toBe(WIN ? WIN_MODE : 0o700);
});

it("writeSecretJson writes mode 0600 JSON under new directories", () => {
  const dir = plant("setup-secret-");
  const p = writeSecretJson(path.join(dir, "a", "b.json"), { k: 1 });
  expect(JSON.parse(fs.readFileSync(p, "utf8"))).toStrictEqual({ k: 1 });
  expect(fs.statSync(p).mode & 0o777).toBe(WIN ? WIN_MODE : 0o600);
});

it("mergeSpeakJson keeps sibling keys inside each provider and the listen block", () => {
  const home = plant("setup-merge-keep-");
  writeAt(
    speakJsonPath(home),
    JSON.stringify({
      elevenlabs: { apiKey: "old", voice: "v" },
      listen: { seconds: 9 },
      openai: { model: "m" },
      provider: "openai",
    }),
  );
  mergeSpeakJson(home, {
    elevenlabs: { apiKey: "new" },
    listen: { device: "hw:1" },
    openai: { apiKey: "oa" },
  });
  expect(readSpeakJson(home)).toStrictEqual({
    elevenlabs: { apiKey: "new", voice: "v" },
    listen: { device: "hw:1", seconds: 9 },
    openai: { apiKey: "oa", model: "m" },
    provider: "openai",
  });
});

it("mergeSpeakJson starts over from a corrupt or non-object file", () => {
  const home = plant("setup-merge-bad-");
  writeAt(speakJsonPath(home), "not json");
  mergeSpeakJson(home, { provider: "openai" });
  expect(readSpeakJson(home)).toStrictEqual({ provider: "openai" });
  writeAt(speakJsonPath(home), "[1]");
  mergeSpeakJson(home, { provider: "elevenlabs" });
  expect(readSpeakJson(home)).toStrictEqual({ provider: "elevenlabs" });
});

it("installOAuthJson accepts inline JSON", () => {
  const dir = plant("setup-install-");
  const dest = installOAuthJson({ dest: path.join(dir, "o.json"), src: JSON.stringify(desktopOauth) });
  expect(JSON.parse(fs.readFileSync(dest, "utf8"))).toStrictEqual(desktopOauth);
});

it("oauthWritePath names the default account for a blank account", () => {
  expect(oauthWritePath("/h", "  ")).toBe(path.join("/h", ".workerstack", "workspace", "default", "google-oauth.json"));
});

it("findDownloadedOAuthJson returns empty when no download dir exists", () => {
  expect(findDownloadedOAuthJson(plant("setup-dl-none-"))).toBe("");
});

it("findDownloadedOAuthJson skips other names, directories and dangling links", () => {
  const home = plant("setup-dl-skip-");
  writeAt(path.join(home, "Downloads", "notes.json"), "{}");
  fs.mkdirSync(path.join(home, "Downloads", "client_secret_dir.json"));
  fs.symlinkSync(path.join(home, "gone"), path.join(home, "Downloads", "client_secret_dangling.json"));
  expect(findDownloadedOAuthJson(home)).toBe("");
  const found = writeAt(path.join(home, "Downloads", "Google-OAuth.json"), "{}");
  expect(findDownloadedOAuthJson(home)).toBe(found);
});

// `Downloads` and `downloads` are two dirs only on a case-sensitive filesystem (Linux); macOS and Windows fold them
// into one.
it.skipIf(process.platform !== "linux")("findDownloadedOAuthJson reads the lowercase downloads dir too", () => {
  const home = plant("setup-dl-lower-");
  writeAt(path.join(home, "Downloads", "notes.json"), "{}");
  const lower = writeAt(path.join(home, "downloads", "Google-OAuth.json"), "{}");
  expect(findDownloadedOAuthJson(home)).toBe(lower);
});

it("workspaceConsoleUrls drops the project query when no project is given", () => {
  const u = workspaceConsoleUrls(undefined);
  expect(u.branding).toBe("https://console.cloud.google.com/auth/overview/create");
  expect(u.enableApis).not.toContain("project=");
  expect(u.clientCreate).toBe("https://console.cloud.google.com/auth/clients/create");
});

it("merges providers without dropping the other", () => {
  const home = plant("setup-merge-");
  mergeSpeakJson(home, { elevenlabs: { apiKey: "sk_el" } });
  const dest = mergeSpeakJson(home, { openai: { apiKey: "sk_oa" } });
  const j = readJsonAt(dest);
  expect(j.elevenlabs?.apiKey).toBe("sk_el");
  expect(j.openai?.apiKey).toBe("sk_oa");
});

it("rejects web OAuth clients", () => {
  expect(() => parseDesktopOAuth({ web: { client_id: "cid" } })).toThrow(/Desktop client/);
});

it("installs Desktop JSON to dest", () => {
  const home = plant("setup-oauth-");
  const src = path.join(home, "client_secret_x.json");
  fs.writeFileSync(src, JSON.stringify(desktopOauth));
  const dest = path.join(home, ".workerstack", "workspace", "default", "google-oauth.json");
  installOAuthJson({ dest, src });
  const j = readJsonAt(dest);
  expect(j.installed?.client_id).toBe("cid.apps.googleusercontent.com");
});

it("finds newest client_secret in Downloads", () => {
  const home = plant("setup-dl-");
  const dir = path.join(home, "Downloads");
  fs.mkdirSync(dir);
  const a = path.join(dir, "client_secret_old.json");
  const b = path.join(dir, "client_secret_new.json");
  fs.writeFileSync(a, "{}");
  fs.writeFileSync(b, "{}");
  const t = Date.now();
  fs.utimesSync(a, t / 1000, (t - 5000) / 1000);
  fs.utimesSync(b, t / 1000, t / 1000);
  expect(findDownloadedOAuthJson(home)).toBe(b);
});

it("oauth write path is ~/.workerstack/workspace/NAME/google-oauth.json", () => {
  const home = plant("setup-owp-");
  expect(oauthWritePath(home, "default")).toBe(
    path.join(home, ".workerstack", "workspace", "default", "google-oauth.json"),
  );
  expect(oauthWritePath(home, "work")).toBe(path.join(home, ".workerstack", "workspace", "work", "google-oauth.json"));
});

it("workspace URLs include project id", () => {
  const u = workspaceConsoleUrls("my-proj");
  expect(u.projectCreate).toMatch(/projectcreate/);
  expect(u.branding).toContain("project=my-proj");
  expect(u.enableApis).toContain("gmail.googleapis.com");
  expect(u.clientCreate).toContain("project=my-proj");
});
