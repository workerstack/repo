import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  findDownloadedOAuthJson,
  installOAuthJson,
  mergeSpeakJson,
  oauthWritePath,
  speakJsonPath,
  stateHome,
  workspaceConsoleUrls,
  writeSecretJson,
} from "./setup.ts";
import { cleanSetup, desktopOauth, plant, readSpeakJson, writeAt } from "./fixtures/setup-kit.ts";

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
  expect(JSON.parse(fs.readFileSync(p, "utf8"))).toEqual({ k: 1 });
  expect(fs.statSync(p).mode & 0o777).toBe(WIN ? WIN_MODE : 0o600);
});

it("mergeSpeakJson keeps sibling keys inside each provider and the listen block", () => {
  const home = plant("setup-merge-keep-");
  writeAt(
    speakJsonPath(home),
    JSON.stringify({
      provider: "openai",
      elevenlabs: { apiKey: "old", voice: "v" },
      openai: { model: "m" },
      listen: { seconds: 9 },
    }),
  );
  mergeSpeakJson(home, {
    elevenlabs: { apiKey: "new" },
    openai: { apiKey: "oa" },
    listen: { device: "hw:1" },
  });
  expect(readSpeakJson(home)).toEqual({
    provider: "openai",
    elevenlabs: { apiKey: "new", voice: "v" },
    openai: { model: "m", apiKey: "oa" },
    listen: { seconds: 9, device: "hw:1" },
  });
});

it("mergeSpeakJson starts over from a corrupt or non-object file", () => {
  const home = plant("setup-merge-bad-");
  writeAt(speakJsonPath(home), "not json");
  mergeSpeakJson(home, { provider: "openai" });
  expect(readSpeakJson(home)).toEqual({ provider: "openai" });
  writeAt(speakJsonPath(home), "[1]");
  mergeSpeakJson(home, { provider: "elevenlabs" });
  expect(readSpeakJson(home)).toEqual({ provider: "elevenlabs" });
});

it("installOAuthJson accepts inline JSON", () => {
  const dir = plant("setup-install-");
  const dest = installOAuthJson({ src: JSON.stringify(desktopOauth), dest: path.join(dir, "o.json") });
  expect(JSON.parse(fs.readFileSync(dest, "utf8"))).toEqual(desktopOauth);
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

// `Downloads` and `downloads` are two dirs only on a case-sensitive filesystem (Linux); macOS and Windows fold them into one.
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
