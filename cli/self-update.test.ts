import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REEXEC_ENV,
  compareVersions,
  fetchLatestVersion,
  selfUpdate,
} from "./self-update.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function okFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

function installedBin(cwd: string) {
  const bin = path.join(cwd, "node_modules", "@lovrozagar", "grunt", "bin", "grunt.js");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, "");
  return bin;
}

describe("compareVersions", () => {
  it("orders major, minor, patch numerically", () => {
    expect(compareVersions("0.8.3", "0.8.4")).toBe(-1);
    expect(compareVersions("0.9.0", "0.8.10")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.8.10", "0.8.9")).toBe(1);
    expect(compareVersions("0.8.3", "0.8.3")).toBe(0);
  });

  it("sorts a prerelease below its release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBe(-1);
  });
});

describe("fetchLatestVersion", () => {
  it("reads the latest dist-tag from the default registry", async () => {
    const fetch = okFetch({ version: "0.9.0" });
    expect(await fetchLatestVersion({ fetch, env: {} })).toBe("0.9.0");
    expect(fetch.mock.calls[0][0]).toBe(
      "https://registry.npmjs.org/@lovrozagar%2fgrunt/latest",
    );
  });

  it("honors npm_config_registry", async () => {
    const fetch = okFetch({ version: "0.9.0" });
    await fetchLatestVersion({ fetch, env: { npm_config_registry: "https://r.example/npm/" } });
    expect(fetch.mock.calls[0][0]).toBe("https://r.example/npm/@lovrozagar%2fgrunt/latest");
  });

  it("returns null on non-200, bad JSON, bad version, or a thrown fetch", async () => {
    expect(await fetchLatestVersion({ fetch: okFetch({}, 404), env: {} })).toBeNull();
    const badJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad");
      },
    }));
    expect(await fetchLatestVersion({ fetch: badJson, env: {} })).toBeNull();
    expect(await fetchLatestVersion({ fetch: okFetch({ version: "latest" }), env: {} })).toBeNull();
    const aborted = vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    expect(await fetchLatestVersion({ fetch: aborted, env: {} })).toBeNull();
  });
});

describe("selfUpdate", () => {
  function setup({
    latest = "0.9.0" as string | null,
    current = "0.8.3",
    env = {} as Record<string, string>,
    withBin = true,
    runStatus = 0 as number | null,
  } = {}) {
    const cwd = tmp("grunt-self-update-");
    const pkgRoot = tmp("grunt-pkg-");
    const fetch = latest == null ? okFetch({}, 500) : okFetch({ version: latest });
    const run = vi.fn((_cmd: string, args: string[]) => {
      if (args[0] === "install" || args[0] === "add") {
        if (withBin) installedBin(cwd);
        return { status: 0 };
      }
      return { status: runStatus };
    });
    const log = vi.fn();
    const opts = {
      cwd,
      pkgRoot,
      currentVersion: current,
      pm: "bun",
      argv: ["upgrade", "--skip-globals"],
      env,
      fetch,
      run,
      log,
    };
    return { opts, fetch, run, log, cwd };
  }

  it("skips when already re-execed", async () => {
    const { opts, fetch, run } = setup({ env: { [REEXEC_ENV]: "1" } });
    expect(await selfUpdate(opts)).toEqual({ reexeced: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("skips inside the grunt package itself", async () => {
    const { opts, fetch } = setup();
    expect(await selfUpdate({ ...opts, pkgRoot: opts.cwd })).toEqual({ reexeced: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips when current is latest or newer", async () => {
    for (const current of ["0.9.0", "0.10.0"]) {
      const { opts, run } = setup({ current });
      expect(await selfUpdate(opts)).toEqual({ reexeced: false });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("warns and continues when the registry check fails", async () => {
    const { opts, run, log } = setup({ latest: null });
    expect(await selfUpdate(opts)).toEqual({ reexeced: false });
    expect(run).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toMatch(/could not check/);
  });

  it("installs latest then re-execs the installed bin", async () => {
    const { opts, run, cwd } = setup({ runStatus: 3 });
    expect(await selfUpdate(opts)).toEqual({ reexeced: true, status: 3 });
    expect(run.mock.calls[0][0]).toBe("bun");
    expect(run.mock.calls[0][1]).toEqual(["add", "-D", "@lovrozagar/grunt@0.9.0"]);
    expect(run.mock.calls[0][2]).toMatchObject({ cwd, stdio: "inherit" });
    const [cmd, args, o] = run.mock.calls[1];
    expect(cmd).toBe(process.execPath);
    expect(fs.realpathSync(args[0])).toBe(
      fs.realpathSync(path.join(cwd, "node_modules", "@lovrozagar", "grunt", "bin", "grunt.js")),
    );
    expect(args.slice(1)).toEqual(["upgrade", "--skip-globals"]);
    expect(o).toMatchObject({ cwd, stdio: "inherit" });
    expect(o.env[REEXEC_ENV]).toBe("1");
  });

  it("reports exit 1 when the re-execed child dies without a status", async () => {
    const { opts } = setup({ runStatus: null });
    expect(await selfUpdate(opts)).toEqual({ reexeced: true, status: 1 });
  });

  it("logs to stderr by default", async () => {
    const { opts } = setup({ latest: null });
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { log: _log, ...rest } = opts;
      await selfUpdate(rest);
      expect(String(write.mock.calls[0][0])).toMatch(/could not check.*\n$/);
    } finally {
      write.mockRestore();
    }
  });

  it("throws when the install fails", async () => {
    const { opts } = setup();
    const run = vi.fn(() => ({ status: 1 }));
    await expect(selfUpdate({ ...opts, run })).rejects.toThrow(/install/);
  });

  it("re-execs through yarn under Plug'n'Play (no node_modules)", async () => {
    const { opts, run, log, cwd } = setup({ withBin: false, runStatus: 0 });
    fs.writeFileSync(path.join(cwd, ".pnp.cjs"), "");
    expect(await selfUpdate(opts)).toEqual({ reexeced: true, status: 0 });
    const [cmd, args, o] = run.mock.calls[1];
    expect(cmd).toBe("yarn");
    expect(args).toEqual(["grunt", "upgrade", "--skip-globals"]);
    expect(o).toMatchObject({ cwd, stdio: "inherit" });
    expect(o.env[REEXEC_ENV]).toBe("1");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("warns and continues when the installed bin is missing", async () => {
    const { opts, run, log } = setup({ withBin: false });
    expect(await selfUpdate(opts)).toEqual({ reexeced: false });
    expect(run).toHaveBeenCalledOnce();
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/not found/);
  });
});
