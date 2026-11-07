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

/** Call `n` of a mock, which the test expects to exist. */
function nthCall<T>(calls: T[], n: number): T {
  const call = calls[n];
  if (call === undefined) throw new Error(`the mock has no call ${n}`);
  return call;
}

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

type SelfUpdateOptions = Parameters<typeof selfUpdate>[0];
type RegistryFetch = NonNullable<SelfUpdateOptions["fetch"]>;
type RunSync = NonNullable<SelfUpdateOptions["run"]>;

function okFetch(body: unknown, status = 200) {
  return vi.fn<RegistryFetch>(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

function installedBin(cwd: string) {
  const bin = path.join(cwd, "node_modules", "@workerstack", "repo", "bin", "repo.js");
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
    expect(nthCall(fetch.mock.calls, 0)[0]).toBe(
      "https://registry.npmjs.org/@workerstack%2frepo/latest",
    );
  });

  it("prefers BUN_CONFIG_REGISTRY over npm_config_registry", async () => {
    const fetch = okFetch({ version: "0.9.0" });
    await fetchLatestVersion({
      fetch,
      env: { BUN_CONFIG_REGISTRY: "https://b.example/", npm_config_registry: "https://r.example/" },
    });
    expect(nthCall(fetch.mock.calls, 0)[0]).toBe("https://b.example/@workerstack%2frepo/latest");
  });

  it("honors npm_config_registry", async () => {
    const fetch = okFetch({ version: "0.9.0" });
    await fetchLatestVersion({ fetch, env: { npm_config_registry: "https://r.example/npm/" } });
    expect(nthCall(fetch.mock.calls, 0)[0]).toBe("https://r.example/npm/@workerstack%2frepo/latest");
  });

  it("returns null on non-200, bad JSON, bad version, or a thrown fetch", async () => {
    expect(await fetchLatestVersion({ fetch: okFetch({}, 404), env: {} })).toBeNull();
    const badJson = vi.fn<RegistryFetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad");
      },
    }));
    expect(await fetchLatestVersion({ fetch: badJson, env: {} })).toBeNull();
    expect(await fetchLatestVersion({ fetch: okFetch({ version: "latest" }), env: {} })).toBeNull();
    const aborted = vi.fn<RegistryFetch>(async () => {
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
    const cwd = tmp("repo-self-update-");
    const pkgRoot = tmp("repo-pkg-");
    const fetch = latest == null ? okFetch({}, 500) : okFetch({ version: latest });
    const run = vi.fn<RunSync>((_cmd, args) => {
      if (args[0] === "install" || args[0] === "add") {
        if (withBin) installedBin(cwd);
        return { status: 0 };
      }
      return { status: runStatus };
    });
    const log = vi.fn<(message: string) => void>();
    const opts = {
      cwd,
      pkgRoot,
      currentVersion: current,
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

  it("skips inside the repo package itself", async () => {
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
    expect(nthCall(log.mock.calls, 0)[0]).toMatch(/could not check/);
  });

  it("installs latest then re-execs the installed bin", async () => {
    const { opts, run, cwd } = setup({ runStatus: 3 });
    expect(await selfUpdate(opts)).toEqual({ reexeced: true, status: 3 });
    expect(nthCall(run.mock.calls, 0)[0]).toBe("bun");
    expect(nthCall(run.mock.calls, 0)[1]).toEqual(["add", "-D", "@workerstack/repo@0.9.0"]);
    expect(nthCall(run.mock.calls, 0)[2]).toMatchObject({ cwd, stdio: "inherit" });
    const [cmd, args, o] = nthCall(run.mock.calls, 1);
    expect(cmd).toBe(process.execPath);
    const [bin] = args;
    expect(bin && fs.realpathSync(bin)).toBe(
      fs.realpathSync(path.join(cwd, "node_modules", "@workerstack", "repo", "bin", "repo.js")),
    );
    expect(args.slice(1)).toEqual(["upgrade", "--skip-globals"]);
    expect(o).toMatchObject({ cwd, stdio: "inherit" });
    expect(o.env?.[REEXEC_ENV]).toBe("1");
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
      expect(String(nthCall(write.mock.calls, 0)[0])).toMatch(/could not check.*\n$/);
    } finally {
      write.mockRestore();
    }
  });

  it("throws when the install fails", async () => {
    const { opts } = setup();
    const run = vi.fn<RunSync>(() => ({ status: 1 }));
    await expect(selfUpdate({ ...opts, run })).rejects.toThrow(/bun add of @workerstack\/repo@0\.9\.0 failed/);
  });

  it("warns and continues when the installed bin is missing", async () => {
    const { opts, run, log } = setup({ withBin: false });
    expect(await selfUpdate(opts)).toEqual({ reexeced: false });
    expect(run).toHaveBeenCalledOnce();
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/not found/);
  });
});
