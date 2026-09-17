import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_REL,
  LOCAL_CONFIG_REL,
  leftoverKeysWarn,
  loadConfig,
  loadSessionGate,
  SESSION_GATES,
  stripJsonc,
} from "./grunt-config.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-config-"));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(ws: string, body: string) {
  const abs = path.join(ws, CONFIG_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function writeLocal(ws: string, body: string) {
  const abs = path.join(ws, LOCAL_CONFIG_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

describe("stripJsonc", () => {
  it("strips line and block comments; empty/nullish → empty string", () => {
    expect(stripJsonc(undefined)).toBe("");
    expect(stripJsonc(null)).toBe("");
    expect(stripJsonc("")).toBe("");
    expect(stripJsonc('{"a":1}')).toBe('{"a":1}');
    expect(stripJsonc('// c\n{"a":1}')).toBe('\n{"a":1}');
    expect(stripJsonc('/* block */\n{"a":1}')).toBe('\n{"a":1}');
    expect(stripJsonc("/* a */ // b\n1")).toBe(" \n1");
  });
});

describe("loadConfig", () => {
  it("missing/unreadable/parse fail/version≠1/non-object → null", () => {
    const ws = tmpWs();
    expect(loadConfig(ws)).toBeNull();
    expect(loadConfig("")).toBeNull();
    expect(loadConfig(undefined as unknown as string)).toBeNull();
    writeConfig(ws, "{ not json");
    expect(loadConfig(ws)).toBeNull();
    writeConfig(ws, '{"version":2}');
    expect(loadConfig(ws)).toBeNull();
    writeConfig(ws, "[]");
    expect(loadConfig(ws)).toBeNull();
    writeConfig(ws, "1");
    expect(loadConfig(ws)).toBeNull();
  });

  it("version 1 object loads; leftover keys ignored", () => {
    const ws = tmpWs();
    writeConfig(ws, '{"version":1,"leftoverGate":"auto"}');
    expect(loadConfig(ws)).toEqual({ version: 1, leftoverGate: "auto" });
  });
});

describe("SESSION_GATES", () => {
  it("is auto|ask only", () => {
    expect([...SESSION_GATES].sort()).toEqual(["ask", "auto"]);
    expect(SESSION_GATES.has("AUTO")).toBe(false);
  });
});

describe("loadSessionGate", () => {
  it("missing/unreadable/version≠1/bad enum → auto", () => {
    const ws = tmpWs();
    expect(loadSessionGate(ws)).toBe("auto");
    expect(loadSessionGate("")).toBe("auto");
    expect(loadSessionGate(undefined as unknown as string)).toBe("auto");
    writeConfig(ws, "{ not json");
    expect(loadSessionGate(ws)).toBe("auto");
    writeConfig(ws, '{"version":2,"sessionGate":"ask"}');
    expect(loadSessionGate(ws)).toBe("auto");
    writeConfig(ws, '{"version":1,"sessionGate":"AUTO"}');
    expect(loadSessionGate(ws)).toBe("auto");
    writeConfig(ws, '{"version":1}');
    expect(loadSessionGate(ws)).toBe("auto");
  });

  it("committed ask; local overlay wins; bad local ignored", () => {
    const ws = tmpWs();
    writeConfig(ws, '{"version":1,"sessionGate":"ask"}');
    expect(loadSessionGate(ws)).toBe("ask");
    writeLocal(ws, '{"sessionGate":"auto"}');
    expect(loadSessionGate(ws)).toBe("auto");
    writeConfig(ws, '{"version":1,"sessionGate":"auto"}');
    writeLocal(ws, '{"sessionGate":"ask"}');
    expect(loadSessionGate(ws)).toBe("ask");
    writeLocal(ws, '{"sessionGate":"ASK"}');
    expect(loadSessionGate(ws)).toBe("auto");
  });
});

describe("leftoverKeysWarn", () => {
  it("empty when missing or clean version 1", () => {
    const ws = tmpWs();
    expect(leftoverKeysWarn("")).toBe("");
    expect(leftoverKeysWarn(ws)).toBe("");
    writeConfig(ws, "{ not json");
    expect(leftoverKeysWarn(ws)).toBe("");
    writeConfig(ws, '{"version":1}');
    expect(leftoverKeysWarn(ws)).toBe("");
  });

  it("warns committed leftoverGate/spawnMode", () => {
    const ws = tmpWs();
    writeConfig(ws, '{"version":1,"leftoverGate":"ask"}');
    expect(leftoverKeysWarn(ws)).toMatch(/leftoverGate\/spawnMode/);
    expect(leftoverKeysWarn(ws)).toMatch(CONFIG_REL);
  });

  it("warns local overlay leftover keys", () => {
    const ws = tmpWs();
    writeConfig(ws, '{"version":1}');
    writeLocal(ws, '{"spawnMode":"solo"}');
    expect(leftoverKeysWarn(ws)).toMatch(LOCAL_CONFIG_REL);
  });
});
