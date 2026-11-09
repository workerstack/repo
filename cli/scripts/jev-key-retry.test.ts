import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { loadJevKey, parseArgv, retryWaitMs } from "./jev.ts";
import { KEY, plantDir } from "./fixtures/jev-kit.ts";
import fs from "node:fs";
import path from "node:path";

afterEach(() => vi.restoreAllMocks());

function plantKeyFile(home: string, text: string) {
  fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
  fs.writeFileSync(path.join(home, ".workerstack", "jev.json"), text);
}

it("loadJevKey: prefers the environment key over the file", () => {
  const home = plantDir();
  plantKeyFile(home, JSON.stringify({ apiKey: "from-file" }));
  expect(loadJevKey({ env: { TYPESAFE_API_KEY: ` ${KEY} ` }, home })).toBe(KEY);
});

it("loadJevKey: falls back to the trimmed file key", () => {
  const home = plantDir();
  plantKeyFile(home, JSON.stringify({ apiKey: " from-file " }));
  expect(loadJevKey({ env: {}, home })).toBe("from-file");
});

it("loadJevKey: is empty for a missing, broken, non-object or keyless file", () => {
  const home = plantDir();
  expect(loadJevKey({ env: {}, home })).toBe("");
  for (const text of ["{broken", "[1]", "{}", JSON.stringify({ apiKey: "" })]) {
    plantKeyFile(home, text);
    expect(loadJevKey({ env: {}, home })).toBe("");
  }
});

it("loadJevKey: reads the process environment and the user's home by default", () => {
  const home = plantDir();
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("TYPESAFE_API_KEY", "");
  expect(loadJevKey()).toBe("");
  plantKeyFile(home, JSON.stringify({ apiKey: "from-file" }));
  expect(loadJevKey()).toBe("from-file");
  vi.stubEnv("TYPESAFE_API_KEY", KEY);
  expect(loadJevKey()).toBe(KEY);
});

const now = Date.parse("2026-10-09T12:00:00Z");

it("retryWaitMs: waits for a Retry-After of up to two seconds", () => {
  expect(retryWaitMs("0", now)).toBe(0);
  expect(retryWaitMs(" 2 ", now)).toBe(2000);
  expect(retryWaitMs("3", now)).toBeNull();
});

it("retryWaitMs: reads an HTTP date relative to now", () => {
  expect(retryWaitMs("Fri, 09 Oct 2026 12:00:01 GMT", now)).toBe(1000);
  expect(retryWaitMs("Fri, 09 Oct 2026 11:59:00 GMT", now)).toBe(0);
  expect(retryWaitMs("Fri, 09 Oct 2026 12:00:09 GMT", now)).toBeNull();
});

it("retryWaitMs: does not retry without a usable header", () => {
  expect(retryWaitMs(null, now)).toBeNull();
  expect(retryWaitMs(undefined, now)).toBeNull();
  expect(retryWaitMs("  ", now)).toBeNull();
  expect(retryWaitMs("soon", now)).toBeNull();
});

it("retryWaitMs: measures a date against the clock when none is given", () => {
  expect(retryWaitMs(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
});

it("parseArgv: reads --name=value, --name value and bare flags", () => {
  expect(parseArgv(["--a=1", "--b", "2", "--c", "--d", "--e=x=y", "--=z", 5, "plain", "--empty", ""]).flags).toEqual({
    a: "1",
    b: "2",
    c: "1",
    d: "1",
    e: "x=y",
    "=z": "5",
    empty: "1",
  });
  expect(parseArgv(["--last"]).flags).toEqual({ last: "1" });
});

it("parseArgv: treats a missing argv as no flags", () => {
  expect(parseArgv(undefined).flags).toEqual({});
});
