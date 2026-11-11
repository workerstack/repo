import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { bytesReply, cfgFor, cleanupTmp, reply, sttFor, tmp, which } from "./fixtures/listen-env.ts";
import { defaultGgmlPath, downloadGgml, ensureStt } from "./listen-whisper.ts";
import { DEFAULT_MODEL, GGML_URL, NEED_STT } from "./listen.constants.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanupTmp();
});

const bins = which({ "whisper-cli": "/usr/bin/whisper-cli" });

/** A fetch that must never run. */
function noFetch(): Promise<never> {
  return Promise.reject(new Error("must not fetch"));
}

describe("downloadGgml failures", () => {
  it("reports a failed download by status, or err when there is none", async () => {
    const home = tmp("listen-dlerr-");
    await expect(downloadGgml({ fetchFn: reply({ ok: false, status: 500 }), home })).rejects.toThrow(/\(500\)/);
    await expect(downloadGgml({ fetchFn: reply({}), home })).rejects.toThrow(/\(err\)/);
    expect(fs.existsSync(defaultGgmlPath(home))).toBe(false);
  });

  it("rejects an empty body and a response with no body reader", async () => {
    const home = tmp("listen-dlempty-");
    const empty = reply({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), ok: true });
    await expect(downloadGgml({ fetchFn: empty, home })).rejects.toThrow("ggml download empty");
    await expect(downloadGgml({ fetchFn: reply({ ok: true }), home })).rejects.toThrow("ggml download empty");
  });
});

describe("downloadGgml success", () => {
  it("writes the model, copying a typed-array body, and logs the destination", async () => {
    const home = tmp("listen-dlok-");
    const errs: string[] = [];
    const log = { error: (m: string) => errs.push(m) };
    const dest = await downloadGgml({ fetchFn: bytesReply([1, 2, 3]), home, log });
    expect([...fs.readFileSync(dest)]).toStrictEqual([1, 2, 3]);
    expect(errs[0]).toContain(dest);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("uses the global fetch when none is passed", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return bytesReply([9])(url, {});
    });
    try {
      await downloadGgml({ home: tmp("listen-dlglobal-") });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(urls).toStrictEqual([GGML_URL]);
  });
});

describe("downloadGgml skip", () => {
  it("does not download when a ggml file already exists", async () => {
    const home = tmp("listen-nodl-");
    const dest = defaultGgmlPath(home);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "already");
    let fetches = 0;
    function fetchFn() {
      fetches += 1;
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(Buffer.from("nope")), ok: true });
    }
    await downloadGgml({ fetchFn, home, log: undefined });
    expect(fetches).toBe(0);
    expect(fs.readFileSync(dest, "utf8")).toBe("already");
  });
});

describe("ensureStt", () => {
  const failing = reply({ ok: false, status: 503 });

  it("rethrows a failed download when local is forced or no key exists", async () => {
    const h1 = tmp("listen-ens1-");
    const forced = cfgFor(h1, { LISTEN_STT: "local", OPENAI_API_KEY: "k" });
    await expect(ensureStt(sttFor(h1, { cfg: forced, fetchFn: failing, whichFn: bins }))).rejects.toThrow(/503/);
    const h2 = tmp("listen-ens2-");
    await expect(ensureStt(sttFor(h2, { fetchFn: failing, whichFn: bins }))).rejects.toThrow(/503/);
  });

  it("downloads the model and returns the local engine", async () => {
    const h3 = tmp("listen-ens3-");
    const stt = await ensureStt(sttFor(h3, { fetchFn: bytesReply([7]), whichFn: bins }));
    expect(stt).toMatchObject({ kind: "local", model: defaultGgmlPath(h3) });
  });

  it("never downloads when openai is forced or no whisper binary exists", async () => {
    const h1 = tmp("listen-ensn1-");
    const fetchFn = noFetch;
    const cfg = cfgFor(h1, { LISTEN_STT: "openai", OPENAI_API_KEY: "k" });
    expect(await ensureStt(sttFor(h1, { cfg, fetchFn, whichFn: bins }))).toMatchObject({ kind: "openai" });
    await expect(ensureStt(sttFor(h1, { fetchFn }))).rejects.toThrow(NEED_STT);
  });

  it("falls back to openai if ggml download fails and a key exists", async () => {
    const home = tmp("listen-dlfail-");
    const cfg = cfgFor(home, { OPENAI_API_KEY: "sk_oa" });
    const fetchFn = reply({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), ok: false, status: 404 });
    const stt = await ensureStt(sttFor(home, { cfg, fetchFn, whichFn: bins }));
    expect(stt).toStrictEqual({ kind: "openai", model: DEFAULT_MODEL });
  });
});
