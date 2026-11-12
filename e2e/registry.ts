/**
 * Local registry for e2e: Verdaccio serves @workerstack/repo from the packed
 * tarball only (never proxied) and proxies everything else to registry.npmjs.org.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net, { type AddressInfo } from "node:net";
import path from "node:path";

import * as tar from "tar";
import { z } from "zod";

import { childEnv } from "../cli/env.ts";
import { readJsonFile } from "../cli/package-json.ts";

export const PACKAGE_NAME = "@workerstack/repo";

export type Registry = { url: string; token: string; close: () => Promise<void> };

/** Writes Verdaccio's config under `root`, its storage beside it; returns the config path. */
function writeConfig(root: string): string {
  const storage = path.join(root, "storage");
  fs.mkdirSync(storage, { recursive: true });
  const config = path.join(root, "config.yaml");
  // JSON is valid YAML.
  fs.writeFileSync(
    config,
    JSON.stringify({
      auth: { htpasswd: { file: path.join(root, "htpasswd"), max_users: 10 } },
      log: { format: "pretty", level: "warn", type: "stdout" },
      // verdaccio matches package patterns in written order: ours, published here, before the npm proxy.
      packages: Object.fromEntries([
        [PACKAGE_NAME, { access: "$all", publish: "$authenticated" }],
        ["**", { access: "$all", proxy: "npmjs", publish: "$authenticated" }],
      ]),
      server: { keepAliveTimeout: 60 },
      storage,
      uplinks: { npmjs: { max_fails: 5, timeout: "60s", url: "https://registry.npmjs.org/" } },
    }),
  );

  return config;
}

/** Starts Verdaccio on `port` with `config`, logging to `root`'s verdaccio.log. */
function spawnVerdaccio(root: string, config: string, port: number): ChildProcess {
  const require = createRequire(import.meta.url);
  const verdaccio = require.resolve("verdaccio/package.json");
  const log = path.join(root, "verdaccio.log");

  // A child process, so no spawnSync in this process can stall the registry.
  return spawn(
    process.execPath,
    [path.join(path.dirname(verdaccio), "bin", "verdaccio"), "-c", config, "-l", `127.0.0.1:${port}`],
    { stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")] },
  );
}

/** The registry's close: stops `child` and waits for it; until then, this process exiting kills it too. */
function closerOf(child: ChildProcess): () => Promise<void> {
  // If this process exits without `close()`, the child must not outlive it.
  function killChild() {
    if (child.exitCode == null) child.kill();
  }

  process.once("exit", killChild);

  return async () => {
    process.removeListener("exit", killChild);

    if (child.exitCode != null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  };
}

/** Adds the e2e user to the registry at `url`; returns its token. */
async function addUser(url: string): Promise<string> {
  const res = await fetch(`${url}-/user/org.couchdb.user:e2e`, {
    body: JSON.stringify({ name: "e2e", password: "e2e-password", type: "user" }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });

  if (!res.ok) throw new Error(`verdaccio adduser failed: ${res.status} ${await res.text()}`);
  const { token } = (await res.json()) /* Verdaccio answers adduser with the new token */ as { token: string };

  return token;
}

export async function startRegistry(root: string): Promise<Registry> {
  const config = writeConfig(root);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const child = spawnVerdaccio(root, config, port);
  const close = closerOf(child);

  try {
    await waitForPing(url, child);
    const token = await addUser(url);

    return { close, token, url };
  } catch (err) {
    await close();
    throw err;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() /* a server listening on TCP has an address */ as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForPing(url: string, child: ChildProcess) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`verdaccio exited with ${child.exitCode}`);

    try {
      const ping = await fetch(`${url}-/ping`);

      if (ping.ok) return;
    } catch {}

    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error("verdaccio did not answer /-/ping within 60s");
}

/** `bun pm pack` the repo; returns the tarball path. */
export function packRepo(repoRoot: string, dest: string): string {
  const r = spawnSync("bun", ["pm", "pack", "--quiet", "--ignore-scripts", "--destination", dest], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (r.status !== 0) throw new Error(`bun pm pack failed:\n${r.stderr}`);
  const filename = r.stdout.trim().split("\n").pop() ?? "";

  return path.join(dest, path.basename(filename));
}

/** Repack `tarball` with a different version (same code) for upgrade tests. */
export function retagTarball(tarball: string, version: string, work: string): string {
  const dir = path.join(work, `retag-${version}`);
  fs.mkdirSync(dir, { recursive: true });
  // node-tar, not the tar binary: Git Bash's GNU tar reads `D:\...` as a remote host.
  tar.x({ cwd: dir, file: tarball, sync: true });
  const pkgPath = path.join(dir, "package", "package.json");
  // A record, not the package.json schema, so the keys keep their order when the file is written back.
  const pkg = readJsonFile(pkgPath, z.record(z.string(), z.unknown()));
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  return packRepo(path.join(dir, "package"), dir);
}

export function publish(reg: Registry, tarball: string, tag: string) {
  run("bun", ["publish", tarball, "--tag", tag, "--registry", reg.url], { NPM_CONFIG_TOKEN: reg.token });
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: childEnv(env),
    shell: process.platform === "win32",
  });

  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
}
