import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { readEnv } from "../env.ts";
import { bare, cleanSetup, desktopOauth, plant, writeAt } from "./__fixtures__/setup-kit.ts";
import { defaultGgmlPath } from "./listen-whisper.ts";
import { mergeSpeakJson } from "./setup-files.ts";
import { firstMissing, formatStatus, menuOptions } from "./setup-menu.ts";
import { browserEngineStatus, lookupChromium, targetStatuses } from "./setup-status.ts";

afterEach(cleanSetup);

it("browserEngineStatus reports both, WSL-only, one missing and none", () => {
  expect(browserEngineStatus("/lp", "/cr", "linux")).toStrictEqual({ extra: "lightpanda,chromium", ok: true });
  expect(browserEngineStatus("", "/cr", "win32")).toStrictEqual({ extra: "chromium,need lightpanda in WSL", ok: true });
  expect(browserEngineStatus("/lp", "", "linux")).toStrictEqual({ extra: "lightpanda,need chromium", ok: false });
  expect(browserEngineStatus("", "", process.platform)).toStrictEqual({
    extra: "need lightpanda,need chromium",
    ok: false,
  });
});

it("browserEngineStatus defaults to the host platform", () => {
  expect(browserEngineStatus("/lp", "/cr").ok).toBe(true);
});

it("lookupChromium finds a chromium on the PATH it is given, and defaults to the process PATH", () => {
  const bin = plant("setup-chromium-");
  const exe = writeAt(path.join(bin, "chromium"), "#!/bin/sh\n", 0o755);
  expect(lookupChromium(undefined, bin)).toBe(exe);
  expect(lookupChromium(() => "", bin, "linux")).toBe("");
  const empty = plant("setup-chromium-empty-");
  vi.stubEnv("PATH", empty);
  expect(lookupChromium()).toBe("");
});

it("targetStatuses skips the listen probe unless listen is a target", async () => {
  const home = plant("setup-st-nolisten-");
  const st = await targetStatuses({ env: {}, home, ...bare, targets: ["browser", "jev"] });
  expect(st.listen).toStrictEqual({ extra: "", ok: false });
});

it("targetStatuses reports local STT with ffmpeg and whisper when the model is planted", async () => {
  const home = plant("setup-st-local-");
  writeAt(defaultGgmlPath(home), "model");
  const st = await targetStatuses({ env: {}, home, pathEnv: "/bin", platform: "linux", whichFn: (n) => `/bin/${n}` });
  expect(st.listen.ok).toBe(true);
  expect(st.listen.extra).toMatch(/^local,ffmpeg,/);
  expect(st.browser).toStrictEqual({ extra: "lightpanda,chromium", ok: true });
});

it("targetStatuses takes the PATH from env, then from the process", async () => {
  const home = plant("setup-st-path-");
  const seen: (string | undefined)[] = [];
  function whichFn(_n: string, p: string | undefined) {
    return (seen.push(p), "");
  }
  await targetStatuses({ env: { PATH: "/from-env" }, home, platform: "linux", targets: [], whichFn });
  await targetStatuses({ env: {}, home, platform: "linux", targets: [], whichFn });
  expect(seen[0]).toBe("/from-env");
  expect(seen.at(-1)).toBe(readEnv().PATH);
});

it("targetStatuses with no options reads the stubbed home and finds no browser on an empty PATH", async () => {
  plant("setup-st-default-", true);
  vi.stubEnv("PATH", plant("setup-st-default-bin-"));
  const st = await targetStatuses();
  expect(st.speak.ok).toBe(false);
  expect(st.browser.ok).toBe(false);
  expect(st.listen.ok).toBe(false);
});

it("formatStatus prints missing for unknown targets and null statuses, and appends extras", () => {
  expect(formatStatus(null, ["speak"])).toBe("speak  missing");
  expect(formatStatus({ jev: { extra: "", ok: false }, speak: { extra: "env", ok: true } }, ["speak", "jev"])).toBe(
    "speak  ok  env\njev  missing",
  );
  expect(formatStatus(undefined).split("\n")).toHaveLength(5);
});

it("menuOptions tags each target ok or missing with its extra", () => {
  const labels = menuOptions(
    { browser: { extra: "need chromium", ok: false }, jev: { extra: "env", ok: true }, speak: { extra: "", ok: true } },
    ["speak", "browser", "jev", "listen"],
  ).map((o) => o.label);
  expect(labels).toStrictEqual([
    "speak (ElevenLabs / OpenAI TTS)  ok",
    "listen (STT)  missing",
    "browser (PATH engines)  missing need chromium",
    "jev (TypeSafe research decision)  ok env",
  ]);
  expect(menuOptions(null).every((o) => o.label.endsWith("missing"))).toBe(true);
});

it("firstMissing picks the first target that is not ok, else the first target", () => {
  const ok = { extra: "", ok: true };
  expect(firstMissing({ listen: ok, speak: ok }, ["speak", "listen"])).toBe("speak");
  expect(firstMissing({ listen: { extra: "", ok: false }, speak: ok }, ["speak", "listen"])).toBe("listen");
  expect(firstMissing(null, ["jev"])).toBe("jev");
  expect(firstMissing({}, [])).toBe("browser");
});

it("marks speak and workspace from ~/.workerstack files", async () => {
  const home = plant("setup-st-");
  mergeSpeakJson(home, { openai: { apiKey: "sk_x" } });
  fs.mkdirSync(path.join(home, ".workerstack", "workspace", "default"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".workerstack", "workspace", "default", "google-oauth.json"),
    JSON.stringify(desktopOauth),
  );
  const st = await targetStatuses({ env: {}, home, pathEnv: "/none", platform: "linux", whichFn: () => "" });
  expect(st.speak.ok).toBe(true);
  expect(st["google-workspace"].ok).toBe(true);
  expect(st.listen.ok).toBe(true);
  expect(st.listen.extra).toMatch(/openai/);
  expect(st.browser.ok).toBe(false);
  expect(formatStatus(st)).toMatch(/speak  ok/);
  expect(formatStatus(st)).toMatch(/browser  missing/);
  expect(firstMissing(st)).toBe("browser");
  const labels = menuOptions(st).map((o) => o.label);
  expect(labels[0]).toMatch(/ok/);
  expect(labels[3]).toMatch(/missing/);
});
