import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanSetup, desktopOauth, plant, writeAt } from "./__fixtures__/setup-kit.ts";
import { normalizeTarget, parseArgv } from "./setup-argv.ts";
import { loadOAuthInput, parseDesktopOAuth } from "./setup-oauth.ts";
import { setupTargets } from "./setup-status.ts";

afterEach(cleanSetup);

it("parseArgv keeps everything after -- as positionals", () => {
  expect(parseArgv(["speak", "--", "--raw", "x"])).toStrictEqual({ _: ["speak", "--raw", "x"], flags: {} });
});

it("parseArgv treats a flag at the end or before another flag as on", () => {
  expect(parseArgv(["--redo"]).flags).toStrictEqual({ redo: "1" });
  expect(parseArgv(["--redo", "--device", "hw:1"]).flags).toStrictEqual({ device: "hw:1", redo: "1" });
});

it("parseArgv keeps positionals and reads --flag=value", () => {
  expect(parseArgv(["7", "--device=hw:1", "jev"])).toStrictEqual({ _: ["7", "jev"], flags: { device: "hw:1" } });
});

it("normalizeTarget maps aliases and rejects the rest", () => {
  expect(normalizeTarget("workspace")).toBe("google-workspace");
  expect(normalizeTarget("google-workspace")).toBe("google-workspace");
  expect(normalizeTarget("  JEV ")).toBe("jev");
  expect(normalizeTarget("browser")).toBe("browser");
  expect(normalizeTarget(undefined)).toBe("");
  expect(normalizeTarget("   ")).toBe("");
});

it("setupTargets always offers browser and jev, and the enabled packs", () => {
  expect(setupTargets()).toStrictEqual(["browser", "jev"]);
  expect(setupTargets(["speak", "clasp"])).toStrictEqual(["speak", "browser", "jev"]);
});

it("parseDesktopOAuth takes a Desktop client and rejects a body without a client id", () => {
  expect(parseDesktopOAuth(JSON.stringify(desktopOauth))).toStrictEqual(desktopOauth);
  expect(() => parseDesktopOAuth('{"installed":{}}')).toThrow(/installed\.client_id/);
  expect(() => parseDesktopOAuth("null")).toThrow(/installed\.client_id/);
});

it("loadOAuthInput reads inline JSON and a file, and rejects empty or missing input", () => {
  const dir = plant("setup-oauth-in-");
  const file = writeAt(path.join(dir, "client_secret.json"), JSON.stringify(desktopOauth));
  expect(loadOAuthInput(JSON.stringify(desktopOauth))).toStrictEqual(desktopOauth);
  expect(loadOAuthInput(` ${file} `)).toStrictEqual(desktopOauth);
  expect(() => loadOAuthInput("")).toThrow(/required/);
  expect(() => loadOAuthInput(path.join(dir, "nope.json"))).toThrow(/not found/);
});

it("loadOAuthInput rejects a directory", () => {
  const dir = plant("setup-oauth-dir-");
  fs.mkdirSync(path.join(dir, "d.json"));
  expect(() => loadOAuthInput(path.join(dir, "d.json"))).toThrow(/not found/);
});

it("reads target and key flags", () => {
  expect(parseArgv(["speak", "--elevenlabs-key", "sk_el", "--skip-verify"])).toStrictEqual({
    _: ["speak"],
    flags: { "elevenlabs-key": "sk_el", "skip-verify": "1" },
  });
});

it("reads --key=value", () => {
  expect(parseArgv(["speak", "--openai-key=sk-oa"])).toStrictEqual({
    _: ["speak"],
    flags: { "openai-key": "sk-oa" },
  });
});

it("aliases google targets", () => {
  expect(normalizeTarget("gw")).toBe("google-workspace");
  expect(normalizeTarget("google")).toBe("google-workspace");
  expect(normalizeTarget("speak")).toBe("speak");
  expect(normalizeTarget("nope")).toBe("");
});
