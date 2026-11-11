import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { deepMerge } from "./deep-merge.ts";
import { plant, plantDirs, plantWorkspace } from "./fixtures/sync-global-kit.ts";
import {
  hostIdsOf,
  loadManifest,
  parseText,
  readDest,
  readPayload,
  resolveDest,
  shouldSkip,
} from "./global-settings-files.ts";
import { parseArgv, syncGlobals } from "./sync-global-settings.ts";
import type { ManifestHost } from "./sync-global-settings.types.ts";

const tmp = plantDirs();

afterEach(() => vi.restoreAllMocks());

const HOST: ManifestHost = {
  dest: ".one/settings.json",
  format: "json",
  id: "one",
  payload: "agents/global-settings/one.json",
};
const MANIFEST = { hosts: [HOST], skipKeyPattern: "^secret$", version: 1 };

function workspace(payload = `{"mode": "yolo"}`) {
  return plantWorkspace(tmp, MANIFEST, { [HOST.payload]: payload });
}

it("parseArgv: treats a non-list argv as no flags", () => {
  expect(parseArgv("--check")).toStrictEqual({ check: false, dryRun: false, host: "all", ok: true });
});

it("resolveDest: needs a home and a dest", () => {
  expect(() => resolveDest(null, "a")).toThrow("home required");
  expect(() => resolveDest("/h", null)).toThrow("dest required");
  expect(() => resolveDest("/h", "")).toThrow("dest required");
});

it("resolveDest: resolves under a root home and to the home itself", () => {
  expect(resolveDest("/", "a/b")).toBe(path.resolve("/a/b"));
  expect(resolveDest("/h", ".")).toBe(path.resolve("/h"));
});

it("shouldSkip: skips nothing without a pattern and matches the pattern otherwise", () => {
  expect(shouldSkip("secret", null)).toBe(false);
  expect(shouldSkip("secret", undefined)).toBe(false);
  expect(shouldSkip("secret", /^secret$/)).toBe(true);
});

it("deepMerge: replaces a non-object dest with the source keys", () => {
  expect(deepMerge("text", { a: 1 }, null)).toStrictEqual({ a: 1 });
});

it("deepMerge: returns the dest copy when the source is not an object", () => {
  expect(deepMerge({ a: 1 }, [1], null)).toStrictEqual({ a: 1 });
  expect(deepMerge(null, null, null)).toStrictEqual({});
});

it("parseText: reads missing text as an empty object", () => {
  expect(parseText(null, "json")).toStrictEqual({});
  expect(parseText(undefined, "toml")).toStrictEqual({});
  expect(parseText("  \n", "json")).toStrictEqual({});
});

it("parseText: rejects json that is not an object", () => {
  expect(() => parseText("[]", "json")).toThrow("not an object");
});

const load = (manifest: unknown) => () => loadManifest(plantWorkspace(tmp, manifest));

it("loadManifest: reads a valid manifest", () => {
  expect(loadManifest(workspace())).toMatchObject({ hosts: [HOST], skipKeyPattern: "^secret$" });
  expect(hostIdsOf(loadManifest(workspace()))).toStrictEqual(new Set(["one", "all"]));
});

it.each([
  ["is not an object", "null", "invalid manifest"],
  ["lacks skipKeyPattern", `{"hosts": []}`, "manifest skipKeyPattern required"],
  ["lacks hosts", `{"skipKeyPattern": "x"}`, "manifest hosts required"],
  [
    "has a host that is not an object",
    `{"skipKeyPattern": "x", "hosts": [1]}`,
    "manifest host needs id and format json|toml",
  ],
  [
    "has a host with a numeric id",
    `{"skipKeyPattern": "x", "hosts": [{"id": 1, "format": "json"}]}`,
    "manifest host needs id and format json|toml",
  ],
  [
    "has a host with an unknown format",
    `{"skipKeyPattern": "x", "hosts": [{"id": "a", "format": "yaml"}]}`,
    "manifest host needs id and format json|toml",
  ],
  [
    "has a host without payload and dest",
    `{"skipKeyPattern": "x", "hosts": [{"id": "a", "format": "json"}]}`,
    "manifest host a needs payload and dest",
  ],
])("loadManifest: rejects a manifest that %s", (_name, text, message) => {
  expect(load(text)).toThrow(message);
});

it("readDest: reads a missing file as empty and a directory as unreadable", () => {
  const home = tmp("yolo-dest-");
  expect(readDest(path.join(home, "none.json"), "json", "none.json")).toStrictEqual({});
  expect(() => readDest(home, "json", "label")).toThrow("unreadable dest: label");
});

it("readDest: calls a file that is not an object unreadable", () => {
  const abs = plant(tmp("yolo-dest-"), "a.json", "[]");
  expect(() => readDest(abs, "json", "a.json")).toThrow("unreadable dest: a.json");
});

it("readPayload: reads the stock payload when no consumer root is given", () => {
  expect(readPayload(workspace(), HOST)).toStrictEqual({ mode: "yolo" });
});

it("readPayload: calls a payload that cannot be read as a file unreadable", () => {
  const ws = plantWorkspace(tmp, MANIFEST);
  fs.mkdirSync(path.join(ws, HOST.payload), { recursive: true });
  expect(() => readPayload(ws, HOST)).toThrow(`unreadable payload: ${HOST.payload}`);
});

it("syncGlobals roots: falls back to the process cwd for the manifest, payloads and overlay", () => {
  const ws = workspace();
  const home = tmp("yolo-home-");
  vi.spyOn(process, "cwd").mockReturnValue(ws);
  expect(syncGlobals({ apply: true, home }).ok).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(home, HOST.dest), "utf8"))).toStrictEqual({ mode: "yolo" });
});

it("syncGlobals roots: fails without a home even in a valid workspace", () => {
  vi.spyOn(process, "cwd").mockReturnValue(workspace());
  expect(syncGlobals()).toStrictEqual({ error: "home required", ok: false, report: [] });
});

it("syncGlobals roots: takes the overlay from the consumer root while the manifest comes from the source root", () => {
  const source = workspace();
  const consumer = tmp("yolo-consumer-");
  plant(consumer, ".repo/global-settings/one.json", `{"mode": "mine"}`);
  const home = tmp("yolo-home-");
  expect(syncGlobals({ apply: true, consumerRoot: consumer, home, sourceRoot: source }).ok).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(home, HOST.dest), "utf8"))).toStrictEqual({ mode: "mine" });
});

it("syncGlobals roots: reports a manifest error as a failed result", () => {
  const ws = plantWorkspace(tmp, "null");
  expect(syncGlobals({ home: tmp("yolo-home-"), workspaceRoot: ws })).toStrictEqual({
    error: "invalid manifest",
    ok: false,
    report: [],
  });
});

it("syncGlobals roots: reports a non-Error throw as text", () => {
  const ws = workspace();
  vi.spyOn(fs, "readFileSync").mockImplementation(() => {
    throw "disk gone";
  });
  expect(syncGlobals({ home: tmp("yolo-home-"), workspaceRoot: ws }).error).toBe("disk gone");
});
