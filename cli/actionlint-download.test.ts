import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { childEnv } from "./env.ts";
import { checkActionlintAt, type Spawn } from "./actionlint.ts";

const dirs: string[] = [];
const temp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-actionlint-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const ARCHIVE = new TextEncoder().encode("an archive");
const sha = createHash("sha256").update(ARCHIVE).digest("hex");
const URL_BASE = "https://github.com/rhysd/actionlint/releases/download/v1.7.12/";
type Call = { command: string; args: string[] };

/** A spawn that plays tar (it unpacks a binary named `exe` into the -C dir) and answers actionlint cleanly. */
function fakes(exe: string, tarCode = 0) {
  const calls: Call[] = [];
  const archives: string[] = [];
  const spawn: Spawn = (command, args) => {
    calls.push({ command, args });
    if (args[0] !== "-xf") return { code: 0, stdout: "[]", stderr: "" };
    archives.push(fs.readFileSync(args[1] ?? "", "utf8"));
    fs.writeFileSync(path.join(args[3] ?? "", exe), "binary");
    return { code: tarCode, stdout: "", stderr: tarCode === 0 ? "" : "tar broke\n" };
  };
  return { calls, archives, spawn };
}

/** A release-pack repo with one workflow and no cache. */
function planted() {
  const root = temp();
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), 'export default { packs: ["release"] };\n');
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), "name: x\n");
  return { root, cacheDir: path.join(temp(), "actionlint", "1.7.12") };
}

const hashes = (key: string) => ({ [key]: sha });
const ok = () => Promise.resolve(ARCHIVE);

it("fetches the archive, checks its hash, unpacks it, caches the binary and runs it", async () => {
  const { root, cacheDir } = planted();
  const { calls, archives, spawn } = fakes("actionlint");
  const urls: string[] = [];
  const fetch = (url: string) => {
    urls.push(url);
    return ok();
  };
  const deps = { fetch, spawn, cacheDir, platform: "linux", arch: "x64", hashes: hashes("linux_amd64") };
  expect(await checkActionlintAt(root, deps)).toStrictEqual({ problems: [] });
  expect(urls).toStrictEqual([`${URL_BASE}actionlint_1.7.12_linux_amd64.tar.gz`]);
  expect(archives).toStrictEqual(["an archive"]);
  expect(calls[0]?.command).toBe("tar");
  expect(calls.at(-1)?.command).toBe(path.join(cacheDir, "actionlint"));
  expect(fs.readdirSync(cacheDir)).toStrictEqual(["actionlint"]);
  await checkActionlintAt(root, { ...deps, fetch: () => Promise.reject(new Error("cached")) });
  expect(urls).toHaveLength(1);
});

it("names its archive and unpack directory for the process, and removes both", async () => {
  const { root, cacheDir } = planted();
  const seen: string[][] = [];
  const spawn: Spawn = (_command, args) => {
    if (args[0] !== "-xf") return { code: 0, stdout: "[]", stderr: "" };
    seen.push([args[1] ?? "", args[3] ?? ""]);
    fs.writeFileSync(path.join(args[3] ?? "", "actionlint"), "binary");
    return { code: 0, stdout: "", stderr: "" };
  };
  const deps = { fetch: ok, spawn, cacheDir, platform: "linux", arch: "arm64", hashes: hashes("linux_arm64") };
  await checkActionlintAt(root, deps);
  expect(seen).toHaveLength(1);
  for (const name of seen[0] ?? []) {
    expect(path.dirname(name)).toBe(cacheDir);
    expect(path.basename(name)).toContain(String(process.pid));
  }
  expect(fs.readdirSync(cacheDir)).toStrictEqual(["actionlint"]);
});

it.each([
  [{ platform: "darwin", arch: "x64", archive: "darwin_amd64.tar.gz", exe: "actionlint" }],
  [{ platform: "darwin", arch: "arm64", archive: "darwin_arm64.tar.gz", exe: "actionlint" }],
  [{ platform: "win32", arch: "x64", archive: "windows_amd64.zip", exe: "actionlint.exe" }],
  [{ platform: "win32", arch: "arm64", archive: "windows_arm64.zip", exe: "actionlint.exe" }],
])("$platform $arch fetches $archive and caches $exe", async ({ platform, arch, archive, exe }) => {
  const { root, cacheDir } = planted();
  const key = archive.replace(/\.(tar\.gz|zip)$/, "");
  const urls: string[] = [];
  const fetch = (url: string) => {
    urls.push(url);
    return ok();
  };
  const { calls, spawn } = fakes(exe);
  await checkActionlintAt(root, { fetch, spawn, cacheDir, platform, arch, hashes: hashes(key) });
  expect(urls).toStrictEqual([`${URL_BASE}actionlint_1.7.12_${archive}`]);
  const tar = platform === "win32" ? `${childEnv().SystemRoot ?? "C:\\Windows"}\\System32\\tar.exe` : "tar";
  expect(calls[0]?.command).toBe(tar);
  expect(fs.readdirSync(cacheDir)).toStrictEqual([exe]);
});

it("refuses an archive whose hash differs and caches nothing", async () => {
  const { root, cacheDir } = planted();
  const { calls, spawn } = fakes("actionlint");
  const wrong = { linux_amd64: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8" };
  const deps = { fetch: ok, spawn, cacheDir, platform: "linux", arch: "x64", hashes: wrong };
  const out = await checkActionlintAt(root, deps);
  expect(out.problems).toStrictEqual([
    `actionlint: actionlint_1.7.12_linux_amd64.tar.gz has sha256 ${sha.slice(0, 8)}\u2026, expected 8aca8db9\u2026; nothing was cached`,
  ]);
  expect(calls).toStrictEqual([]);
  expect(fs.readdirSync(cacheDir)).toStrictEqual([]);
});

it.each([
  ["an error", new Error("fetch failed"), "fetch failed"],
  ["a bare value", "offline", "offline"],
])("reports a fetch that rejects with %s", async (_name, reason, text) => {
  const { root, cacheDir } = planted();
  const { calls, spawn } = fakes("actionlint");
  const fetch = () => Promise.reject(reason);
  const out = await checkActionlintAt(root, { fetch, spawn, cacheDir, platform: "linux", arch: "x64" });
  expect(out.problems).toStrictEqual([
    `actionlint: could not fetch 1.7.12 (${text}); connect once so repo can cache it`,
  ]);
  expect(calls).toStrictEqual([]);
});

it("reports a tar that fails and removes what it made", async () => {
  const { root, cacheDir } = planted();
  const { spawn } = fakes("actionlint", 1);
  const deps = { fetch: ok, spawn, cacheDir, platform: "linux", arch: "x64", hashes: hashes("linux_amd64") };
  const out = await checkActionlintAt(root, deps);
  expect(out.problems).toStrictEqual(["actionlint: could not unpack actionlint_1.7.12_linux_amd64.tar.gz: tar broke"]);
  expect(fs.readdirSync(cacheDir)).toStrictEqual([]);
});

it.each([
  ["freebsd", "x64"],
  ["linux", "ia32"],
])("says %s %s is unsupported and fetches nothing", async (platform, arch) => {
  const { root, cacheDir } = planted();
  const fetch = () => Promise.reject(new Error("no"));
  const out = await checkActionlintAt(root, { fetch, spawn: fakes("x").spawn, cacheDir, platform, arch });
  expect(out.problems).toStrictEqual([
    `actionlint: no 1.7.12 build for ${platform} ${arch}; run repo check on linux, macOS or Windows`,
  ]);
});

it("treats a platform with no pinned hash as a mismatch", async () => {
  const { root, cacheDir } = planted();
  const deps = { fetch: ok, spawn: fakes("actionlint").spawn, cacheDir, platform: "linux", arch: "x64", hashes: {} };
  const out = await checkActionlintAt(root, deps);
  expect(out.problems).toStrictEqual([
    `actionlint: actionlint_1.7.12_linux_amd64.tar.gz has sha256 ${sha.slice(0, 8)}…, expected …; nothing was cached`,
  ]);
});
