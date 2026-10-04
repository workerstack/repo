/**
 * Local npm registry for e2e: Verdaccio serves @lovrozagar/grunt from the packed
 * tarball only (never proxied) and proxies everything else to registry.npmjs.org.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import * as tar from "tar";

const require = createRequire(import.meta.url);

export const GRUNT_PACKAGE = "@lovrozagar/grunt";

export type Registry = { url: string; npmrc: string; close: () => Promise<void> };

export async function startRegistry(root: string): Promise<Registry> {
  const storage = path.join(root, "storage");
  fs.mkdirSync(storage, { recursive: true });
  const config = path.join(root, "config.yaml");
  // JSON is valid YAML.
  fs.writeFileSync(
    config,
    JSON.stringify({
      storage,
      auth: { htpasswd: { file: path.join(root, "htpasswd"), max_users: 10 } },
      uplinks: { npmjs: { url: "https://registry.npmjs.org/", timeout: "60s", max_fails: 5 } },
      packages: {
        [GRUNT_PACKAGE]: { access: "$all", publish: "$authenticated" },
        "**": { access: "$all", publish: "$authenticated", proxy: "npmjs" },
      },
      server: { keepAliveTimeout: 60 },
      log: { type: "stdout", format: "pretty", level: "warn" },
    }),
  );
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  // A child process, so no spawnSync in this process can stall the registry.
  const child = spawn(process.execPath, [path.join(path.dirname(require.resolve("verdaccio/package.json")), "bin", "verdaccio"), "-c", config, "-l", `127.0.0.1:${port}`], {
    stdio: ["ignore", fs.openSync(path.join(root, "verdaccio.log"), "a"), fs.openSync(path.join(root, "verdaccio.log"), "a")],
  });
  await waitForPing(url, child);

  const res = await fetch(`${url}-/user/org.couchdb.user:e2e`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "e2e", password: "e2e-password", type: "user" }),
  });
  if (!res.ok) throw new Error(`verdaccio adduser failed: ${res.status} ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  const npmrc = path.join(root, "publish.npmrc");
  fs.writeFileSync(npmrc, `registry=${url}\n//127.0.0.1:${port}/:_authToken=${token}\n`);

  return {
    url,
    npmrc,
    close: async () => {
      if (child.exitCode != null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForPing(url: string, child: ChildProcess) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`verdaccio exited with ${child.exitCode}`);
    try {
      if ((await fetch(`${url}-/ping`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("verdaccio did not answer /-/ping within 60s");
}

/** `npm pack` the repo; returns the tarball path. */
export function packRepo(repoRoot: string, dest: string): string {
  const r = spawnSync("npm", ["pack", "--json", "--pack-destination", dest], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) throw new Error(`npm pack failed:\n${r.stderr}`);
  const [{ filename }] = JSON.parse(r.stdout) as [{ filename: string }];
  return path.join(dest, path.basename(filename));
}

/** Repack `tarball` with a different version (same code) for upgrade tests. */
export function retagTarball(tarball: string, version: string, work: string): string {
  const dir = path.join(work, `retag-${version}`);
  fs.mkdirSync(dir, { recursive: true });
  // node-tar, not the tar binary: Git Bash's GNU tar reads `D:\...` as a remote host.
  tar.x({ file: tarball, cwd: dir, sync: true });
  const pkgPath = path.join(dir, "package", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return packRepo(path.join(dir, "package"), dir);
}

export function publish(reg: Registry, tarball: string, tag: string) {
  run("npm", ["publish", tarball, "--tag", tag, "--registry", reg.url, "--userconfig", reg.npmrc]);
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
}
