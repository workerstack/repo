import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BASE, OUT, STRYKER_PKG, at, fakes, sim } from "./fixtures/mutate-fakes.ts";
import { git, removePlanted, repoOnMain, tempDir } from "./fixtures/planted-repo.ts";
import { main, runMutate } from "./mutate.ts";
import { realDeps, realFs } from "./mutate-real-deps.ts";

afterEach(removePlanted);

it("runs git in its own repo with a hook's GIT_DIR and GIT_INDEX_FILE planted, and leaves the other repo alone", () => {
  const other = repoOnMain({ "a.txt": "a\n" });
  const source = repoOnMain({ "b.txt": "b\n" });
  const planted = path.join(other, ".git", "planted-index");
  vi.stubEnv("GIT_DIR", path.join(other, ".git"));
  vi.stubEnv("GIT_INDEX_FILE", planted);
  const deps = realDeps(source);
  const clone = path.join(tempDir(), "clone");
  const sha = deps.git(source, ["rev-parse", "HEAD"]).stdout.trim();
  expect(sha).toBe(git(source, "rev-parse", "HEAD").trim());
  expect(deps.git(source, ["clone", "-q", "--shared", source, clone]).code).toBe(0);
  expect(deps.git(source, ["-C", clone, "checkout", "-q", "--detach", sha]).code).toBe(0);
  expect(fs.readFileSync(path.join(clone, "b.txt"), "utf8").replaceAll("\r\n", "\n")).toBe("b\n"); // autocrlf may check out CRLF
  expect(fs.existsSync(planted)).toBe(false);
  vi.unstubAllEnvs();
  expect(git(other, "status", "--porcelain")).toBe("");
  expect(git(source, "status", "--porcelain")).toBe("");
});

it("reports a missing git or dir as a failed run instead of throwing", () => {
  const run = realDeps("/").git(path.join(tempDir(), "missing"), ["status"]);
  expect(run.code).not.toBe(0);
  expect(run.stderr).not.toBe("");
});

it("reads and writes files, lists a dir, and tells a missing file and dir from an empty one", () => {
  const real = realFs;
  const dir = tempDir();
  expect([real.read(path.join(dir, "x/y.json")), real.list(path.join(dir, "x"))]).toEqual([null, null]);
  real.write(path.join(dir, "x/y.json"), "{}");
  expect([real.read(path.join(dir, "x/y.json")), real.list(path.join(dir, "x"))]).toEqual(["{}", ["y.json"]]);
  const base = real.mkdtemp("workerstack-mutate-test-");
  expect(path.basename(base)).toMatch(/^workerstack-mutate-test-/);
  real.rm(base);
  expect(fs.existsSync(base)).toBe(false);
});

it("finds the config of the repo above cwd, its errors, and no config", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), 'export default { coverage: { mutate: ["lib/**"] } };\n');
  fs.mkdirSync(path.join(root, "deep"));
  expect(await realDeps(path.join(root, "deep")).config(path.join(root, "deep"))).toEqual({
    root: fs.realpathSync(root),
    mutate: ["lib/**"],
    floors: "mutation-floors.json",
  });
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), "export default { coverage: 5 };\n");
  const bad = await realDeps(root).config(root);
  expect(Array.isArray(bad) && bad[0]).toMatch(/^workerstack.config.ts: coverage/);
  const none = await realDeps(tempDir()).config(tempDir());
  expect(Array.isArray(none) && none[0]).toMatch(/^no workerstack.config.ts in/);
});

it("lists workspace package dirs, none for an unreadable manifest", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
  fs.mkdirSync(path.join(root, "packages/a"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages/a/package.json"), "{}");
  expect(realDeps(root).packages(root)).toEqual(["packages/a"]);
  fs.writeFileSync(path.join(root, "package.json"), "[");
  expect(realDeps(root).packages(root)).toEqual([]);
});

const args = ["--shard", "1/2", "--report", OUT];

it.each(["{", "{}"])("treats a Stryker manifest %j as a missing install", async (manifest) => {
  const f = fakes(sim());
  const read = f.deps.fs.read;
  f.deps.fs.read = (file) => (file === STRYKER_PKG ? manifest : read(file));
  expect(await runMutate(args, f.deps)).toBe(1);
  expect(f.err.join("")).toContain("install the mutation tool first");
});

it("takes a bin written as a string", async () => {
  const f = fakes(sim());
  const read = f.deps.fs.read;
  f.deps.fs.read = (file) => (file === STRYKER_PKG ? '{"bin":"bin/s.js"}' : read(file));
  expect(await runMutate(args, f.deps)).toBe(0);
  expect(f.calls.some((c) => c.includes(path.join("core", "bin", "s.js")))).toBe(true);
});

it("refuses a raw report that is no JSON", async () => {
  const f = fakes(sim());
  f.deps.run = (a) => {
    if (a[0] !== "install") f.deps.fs.write(path.join(BASE, "stryker-report.json"), "{");
    return { code: 0, stdout: "", stderr: "" };
  };
  expect(await runMutate(args, f.deps)).toBe(1);
  expect(f.err.join("")).toMatch(/Stryker wrote no readable report: .*JSON/);
});

it("says a failed install's stdout when its stderr is empty", async () => {
  const f = fakes(sim());
  f.deps.run = () => ({ code: 1, stdout: "lockfile had changes\n", stderr: "" });
  expect(await runMutate(args, f.deps)).toBe(1);
  expect(f.err.join("")).toBe("repo mutate: bun install --frozen-lockfile failed in the clone: lockfile had changes\n");
});

it("counts a tracked file the clone lacks as one empty line", async () => {
  const f = fakes(sim({ tracked: ["src/a.ts", "src/b.ts", "src/gone.ts"] }));
  expect(await runMutate(["--shard", "2/2", "--report", OUT], f.deps)).toBe(0);
  expect(f.out.join("")).toContain("2 files, shard 2/2");
});

it("writes through the process streams, and main runs in the current directory", async () => {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    const deps = realDeps("/");
    deps.out("to stdout\n");
    deps.err("to stderr\n");
    expect(await main(["--fast"])).toBe(1);
    expect(stdout.mock.calls).toEqual([["to stdout\n"]]);
    expect(stderr.mock.calls.map(([text]) => String(text))).toEqual([
      "to stderr\n",
      'repo mutate: unknown argument "--fast"; use --shard i/n, --report <file> or check <dir>\n',
    ]);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
});

it("resolves a typed --report and check dir against the current directory, the default report against the root", async () => {
  const run = fakes(sim());
  run.deps.cwd = at("sub");
  expect(await runMutate(["--shard", "1/2", "--report", "out/m.json"], run.deps)).toBe(0);
  expect(run.files.has(at("sub", "out", "m.json"))).toBe(true);
  expect(run.out.join("")).toContain("in out/m.json");
  const whole = fakes(sim());
  whole.deps.cwd = at("sub");
  await runMutate([], whole.deps);
  expect(whole.files.has(at(".tmp/repo/mutation/report.json"))).toBe(true);
  const report = JSON.stringify({ head: "09ed564aaaa", shard: { index: 1, total: 1 }, files: {} });
  const check = fakes(sim());
  check.deps.cwd = at("sub");
  check.files.set(at("sub", "reports", "mutation-1.json"), report);
  expect(await runMutate(["check", "reports"], check.deps)).toBe(0);
  expect(check.out.join("")).toContain("1 shard of 09ed564");
});
