import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readEnv } from "../env.ts";
import { defaultGgmlPath } from "./listen.ts";
import {
  browserEngineStatus,
  firstMissing,
  formatStatus,
  lookupChromium,
  menuOptions,
  targetStatuses,
} from "./setup.ts";
import { bare, cleanSetup, plant, writeAt } from "./fixtures/setup-kit.ts";

afterEach(cleanSetup);

it("browserEngineStatus reports both, WSL-only, one missing and none", () => {
  expect(browserEngineStatus("/lp", "/cr", "linux")).toEqual({ ok: true, extra: "lightpanda,chromium" });
  expect(browserEngineStatus("", "/cr", "win32")).toEqual({ ok: true, extra: "chromium,need lightpanda in WSL" });
  expect(browserEngineStatus("/lp", "", "linux")).toEqual({ ok: false, extra: "lightpanda,need chromium" });
  expect(browserEngineStatus("", "", process.platform)).toEqual({
    ok: false,
    extra: "need lightpanda,need chromium",
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
  const st = await targetStatuses({ home, env: {}, ...bare, targets: ["browser", "jev"] });
  expect(st.listen).toEqual({ ok: false, extra: "" });
});

it("targetStatuses reports local STT with ffmpeg and whisper when the model is planted", async () => {
  const home = plant("setup-st-local-");
  writeAt(defaultGgmlPath(home), "model");
  const st = await targetStatuses({ home, env: {}, whichFn: (n) => `/bin/${n}`, pathEnv: "/bin", platform: "linux" });
  expect(st.listen.ok).toBe(true);
  expect(st.listen.extra).toMatch(/^local,ffmpeg,/);
  expect(st.browser).toEqual({ ok: true, extra: "lightpanda,chromium" });
});

it("targetStatuses takes the PATH from env, then from the process", async () => {
  const home = plant("setup-st-path-");
  const seen: (string | undefined)[] = [];
  const whichFn = (_n: string, p: string | undefined) => (seen.push(p), "");
  await targetStatuses({ home, env: { PATH: "/from-env" }, whichFn, platform: "linux", targets: [] });
  await targetStatuses({ home, env: {}, whichFn, platform: "linux", targets: [] });
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
  expect(formatStatus({ speak: { ok: true, extra: "env" }, jev: { ok: false, extra: "" } }, ["speak", "jev"])).toBe(
    "speak  ok  env\njev  missing",
  );
  expect(formatStatus(undefined).split("\n")).toHaveLength(5);
});

it("menuOptions tags each target ok or missing with its extra", () => {
  const labels = menuOptions(
    { speak: { ok: true, extra: "" }, jev: { ok: true, extra: "env" }, browser: { ok: false, extra: "need chromium" } },
    ["speak", "browser", "jev", "listen"],
  ).map((o) => o.label);
  expect(labels).toEqual([
    "speak (ElevenLabs / OpenAI TTS)  ok",
    "listen (STT)  missing",
    "browser (PATH engines)  missing need chromium",
    "jev (TypeSafe research decision)  ok env",
  ]);
  expect(menuOptions(null).every((o) => o.label.endsWith("missing"))).toBe(true);
});

it("firstMissing picks the first target that is not ok, else the first target", () => {
  const ok = { ok: true, extra: "" };
  expect(firstMissing({ speak: ok, listen: ok }, ["speak", "listen"])).toBe("speak");
  expect(firstMissing({ speak: ok, listen: { ok: false, extra: "" } }, ["speak", "listen"])).toBe("listen");
  expect(firstMissing(null, ["jev"])).toBe("jev");
  expect(firstMissing({}, [])).toBe("browser");
});
