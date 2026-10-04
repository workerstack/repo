/**
 * Consumer sandboxes: a fresh git repo, an empty HOME, its own TMPDIR, and an env
 * scrubbed of the outer package manager so detection sees only what a user would.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { inject } from "vitest";
import { GRUNT_PACKAGE } from "./registry";

export type PmCase = {
  id: string;
  pm: "npm" | "bun" | "pnpm" | "yarn";
  /** package.json "packageManager" (corepack pins pnpm/yarn). */
  field?: string;
  /** How a user launches grunt without having it installed. */
  launch: (spec: string) => [string, string[]];
};

export const PM_CASES: PmCase[] = [
  { id: "npx", pm: "npm", launch: (s) => ["npx", ["--yes", s]] },
  { id: "bunx", pm: "bun", launch: (s) => ["bunx", [s]] },
  { id: "pnpm dlx", pm: "pnpm", field: "pnpm@10.34.6", launch: (s) => ["pnpm", ["dlx", s]] },
  { id: "yarn classic (npx)", pm: "yarn", field: "yarn@1.22.22", launch: (s) => ["npx", ["--yes", s]] },
  { id: "yarn berry dlx", pm: "yarn", field: "yarn@4.18.1", launch: (s) => ["yarn", ["dlx", s]] },
];

const INHERITED_PM_ENV = /^(npm_|bun_|yarn_|pnpm_|corepack_|berry_|init_cwd$|ci$|github_actions$|continuous_integration$|vitest)/i;

export type Run = { status: number | null; stdout: string; stderr: string; out: string };

export class Sandbox {
  readonly root: string;
  readonly home: string;
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  private logN = 0;

  constructor(name: string, readonly pmCase: PmCase) {
    const runRoot = inject("runRoot");
    const registry = inject("registryUrl");
    this.root = fs.mkdtempSync(path.join(runRoot, `${name.replace(/\W+/g, "-")}-`));
    this.home = path.join(this.root, "home");
    this.repo = path.join(this.root, "repo");
    const tmp = path.join(this.root, "tmp");
    const cache = path.join(runRoot, "cache");
    for (const d of [this.home, this.repo, tmp, path.join(this.root, "logs")]) fs.mkdirSync(d, { recursive: true });

    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!INHERITED_PM_ENV.test(k)) env[k] = v;
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
    const host = new URL(registry).hostname;
    Object.assign(env, {
      [pathKey]: `${path.join(runRoot, "bin")}${path.delimiter}${env[pathKey] ?? ""}`,
      HOME: this.home,
      USERPROFILE: this.home,
      TMPDIR: tmp,
      TEMP: tmp,
      TMP: tmp,
      XDG_CONFIG_HOME: path.join(this.home, ".config"),
      XDG_DATA_HOME: path.join(this.home, ".local", "share"),
      XDG_CACHE_HOME: path.join(cache, "xdg"),
      npm_config_registry: registry,
      NPM_CONFIG_REGISTRY: registry,
      BUN_CONFIG_REGISTRY: registry,
      YARN_REGISTRY: registry,
      YARN_NPM_REGISTRY_SERVER: registry,
      YARN_UNSAFE_HTTP_WHITELIST: host,
      YARN_ENABLE_TELEMETRY: "0",
      // Yarn 4 quarantines versions younger than its age gate; ours were published seconds ago.
      YARN_NPM_MINIMAL_AGE_GATE: "0",
      npm_config_cache: path.join(cache, "npm"),
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
      BUN_INSTALL_CACHE_DIR: path.join(cache, "bun"),
      YARN_CACHE_FOLDER: path.join(cache, `yarn-${pmCase.field ?? "none"}`),
      COREPACK_HOME: path.join(cache, "corepack"),
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      COREPACK_ENABLE_AUTO_PIN: "0",
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
    if (this.pmCase.field) pkg.packageManager = this.pmCase.field;
    this.write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
    this.write("src/index.ts", "export const answer = 42\n");
    this.write(".gitignore", "node_modules/\n.yarn/\n.pnp.*\n");
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

  json(rel: string) {
    return JSON.parse(this.read(rel));
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

  /** Launch grunt the way a user does before it is installed. */
  launch(spec: string, ...args: string[]) {
    const [cmd, pre] = this.pmCase.launch(spec);
    return this.run(cmd, [...pre, ...args]);
  }

  /** Yarn Plug'n'Play consumer: no node_modules, modules resolve through .pnp.cjs. */
  get pnp() {
    return this.exists(".pnp.cjs");
  }

  /** The grunt bin installed into the consumer, resolved the way the consumer resolves it. */
  grunt(...args: string[]) {
    if (this.pnp) return this.run("yarn", ["grunt", ...args]);
    return this.run(process.execPath, [path.join(this.repo, "node_modules", GRUNT_PACKAGE, "bin", "grunt.js"), ...args]);
  }

  /** Node with the consumer's module resolution. */
  node(...args: string[]) {
    return this.pnp ? this.run("yarn", ["node", ...args]) : this.run(process.execPath, args);
  }

  pmRun(script: string, ...args: string[]) {
    return this.run(this.pmCase.pm, ["run", script, ...(this.pmCase.pm === "npm" && args.length ? ["--"] : []), ...args]);
  }

  /** Async on purpose: a blocking spawnSync starves the vitest worker RPC during long installs. */
  async run(cmd: string, args: string[], { input, env }: { input?: string; env?: NodeJS.ProcessEnv } = {}): Promise<Run> {
    // Windows package managers are .cmd shims and need a shell; real executables must not get one.
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
    fs.writeFileSync(path.join(this.root, "logs", `${String(this.logN).padStart(2, "0")}-${path.basename(cmd)}.log`), out);
    return { status, stdout, stderr, out };
  }

  expectOk(r: Run) {
    if (r.status !== 0) throw new Error(`command failed (logs: ${path.join(this.root, "logs")})\n${tail(r.out)}`);
    return r;
  }
}

const RUN_TIMEOUT_MS = 600_000;
const NATIVE_EXES =new Set([process.execPath, "bash", "git"]);

export const BROKEN_RUNTIME = /ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|SyntaxError|ReferenceError|TypeError: .* is not a function|ERR_REQUIRE_ESM|ERR_UNKNOWN_FILE_EXTENSION/;

export function tail(text: string, lines = 80) {
  return text.split("\n").slice(-lines).join("\n");
}

function quoteWin(a: string) {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}
