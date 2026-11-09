/**
 * Consumer sandboxes: a fresh git repo, an empty HOME, its own TMPDIR, and an env
 * scrubbed of the outer bun and CI env so the run sees only what a user would.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { inject } from "vitest";
import { PACKAGE_NAME } from "./registry";

const INHERITED_ENV = /^(npm_|bun_|init_cwd$|ci$|github_actions$|continuous_integration$|vitest)/i;

export type Run = { status: number | null; stdout: string; stderr: string; out: string };

export class Sandbox {
  readonly root: string;
  readonly home: string;
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  private logN = 0;

  constructor(name: string) {
    const runRoot = inject("runRoot");
    const registry = inject("registryUrl");
    this.root = fs.mkdtempSync(path.join(runRoot, `${name.replace(/\W+/g, "-")}-`));
    this.home = path.join(this.root, "home");
    this.repo = path.join(this.root, "repo");
    const tmp = path.join(this.root, "tmp");
    const cache = path.join(runRoot, "cache");
    for (const d of [this.home, this.repo, tmp, path.join(this.root, "logs")]) fs.mkdirSync(d, { recursive: true });

    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!INHERITED_ENV.test(k)) env[k] = v;
    Object.assign(env, {
      HOME: this.home,
      USERPROFILE: this.home,
      TMPDIR: tmp,
      TEMP: tmp,
      TMP: tmp,
      XDG_CONFIG_HOME: path.join(this.home, ".config"),
      XDG_DATA_HOME: path.join(this.home, ".local", "share"),
      XDG_CACHE_HOME: path.join(cache, "xdg"),
      BUN_CONFIG_REGISTRY: registry,
      BUN_INSTALL_CACHE_DIR: path.join(cache, "bun"),
      GIT_AUTHOR_NAME: "e2e",
      GIT_AUTHOR_EMAIL: "e2e@example.com",
      GIT_COMMITTER_NAME: "e2e",
      GIT_COMMITTER_EMAIL: "e2e@example.com",
    });
    this.env = env;
  }

  /** Minimal consumer: package.json, one source file, one commit. */
  async scaffold(extra: Record<string, unknown> = {}) {
    const pkg: Record<string, unknown> = { name: "consumer", version: "0.0.0", private: true, ...extra };
    this.write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
    this.write("src/index.ts", "export const answer = 42;\n");
    this.write(".gitignore", "node_modules/\n");
    await this.git("init", "-q", "-b", "main");
    await this.commit("scaffold");
  }

  write(rel: string, text: string) {
    const abs = path.join(this.repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }

  read(rel: string) {
    return fs.readFileSync(path.join(this.repo, rel), "utf8");
  }

  /** `rel` parsed as JSON, refused unless `is` accepts its shape. */
  json<T>(rel: string, is: (v: unknown) => v is T): T {
    const text = this.read(rel);
    const value = JSON.parse(text);
    if (!is(value)) throw new Error(`${rel} does not hold the expected shape: ${text}`);
    return value;
  }

  exists(rel: string) {
    return fs.existsSync(path.join(this.repo, rel));
  }

  async git(...args: string[]) {
    return this.expectOk(await this.run("git", args));
  }

  async commit(msg: string) {
    await this.git("add", "-A");
    await this.git("commit", "-q", "--allow-empty", "-m", msg);
  }

  /** Launch repo the way a user does before it is installed. */
  launch(spec: string, ...args: string[]) {
    return this.run("bunx", [spec, ...args]);
  }

  /** The repo bin installed into the consumer, run by bun as its shebang says. */
  cli(...args: string[]) {
    return this.run("bun", [path.join(this.repo, "node_modules", PACKAGE_NAME, "bin", "repo.ts"), ...args]);
  }

  bunRun(script: string, ...args: string[]) {
    return this.run("bun", ["run", script, ...args]);
  }

  /** Async on purpose: a blocking spawnSync starves the vitest worker RPC during long installs. */
  async run(
    cmd: string,
    args: string[],
    { input, env }: { input?: string; env?: NodeJS.ProcessEnv } = {},
  ): Promise<Run> {
    // Windows bun shims are .cmd files and need a shell; real executables must not get one.
    const shell = process.platform === "win32" && !NATIVE_EXES.has(cmd);
    const child = spawn(cmd, shell ? args.map(quoteWin) : args, {
      cwd: this.repo,
      env: { ...this.env, ...env },
      shell,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
    const killer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    const { status, error } = await new Promise<{ status: number | null; error?: Error }>((resolve) => {
      child.once("error", (e) => resolve({ status: null, error: e }));
      child.once("close", (code) => resolve({ status: code }));
    });
    clearTimeout(killer);
    const out = `$ ${cmd} ${args.join(" ")}\n[status ${status}${error ? ` error ${error.message}` : ""}]\n--- stdout\n${stdout}\n--- stderr\n${stderr}\n`;
    this.logN += 1;
    fs.writeFileSync(
      path.join(this.root, "logs", `${String(this.logN).padStart(2, "0")}-${path.basename(cmd)}.log`),
      out,
    );
    return { status, stdout, stderr, out };
  }

  expectOk(r: Run) {
    if (r.status !== 0) throw new Error(`command failed (logs: ${path.join(this.root, "logs")})\n${tail(r.out)}`);
    return r;
  }
}

const RUN_TIMEOUT_MS = 600_000;
const NATIVE_EXES = new Set([process.execPath, "bash", "git"]);

export const BROKEN_RUNTIME =
  /ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|SyntaxError|ReferenceError|TypeError: .* is not a function|ERR_REQUIRE_ESM|ERR_UNKNOWN_FILE_EXTENSION/;

export function tail(text: string, lines = 80) {
  return text.split("\n").slice(-lines).join("\n");
}

function quoteWin(a: string) {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}
