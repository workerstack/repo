import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cfgFor, cleanupTmp, jsonReply, reply, tmp } from "./fixtures/listen-env.ts";
import { transcribe, transcribeLocal } from "./listen-whisper.ts";
import { NEED_STT } from "./listen.constants.ts";
import type { FetchFn, SpawnSyncResult, Stt } from "./listen.types.ts";

afterEach(cleanupTmp);

function wavIn(prefix: string): string {
  const wav = path.join(tmp(prefix), "a.wav");
  fs.writeFileSync(wav, "RIFF");
  return wav;
}

function localRun(file: string, r: SpawnSyncResult | ((args: string[]) => SpawnSyncResult)) {
  function spawnSyncFn(_cmd: string, args: string[]) {
    return typeof r === "function" ? r(args) : r;
  }
  return transcribeLocal({ bin: "whisper-cli", file, model: "/m.bin", spawnSyncFn });
}

function writeTxt(args: string[], content: string) {
  fs.writeFileSync(`${args[args.indexOf("-of") + 1]}.txt`, content);
}

describe("transcribeLocal output", () => {
  it("rejects a missing file", () => {
    const missing = path.join(tmp("listen-tl0-"), "none.wav");
    expect(() => localRun(missing, { status: 0 })).toThrow("transcribe needs an audio file");
  });

  it("reads and removes the .txt the binary wrote, passing the model and file", () => {
    const wav = wavIn("listen-tl1-");
    let argv: string[] = [];
    const text = localRun(wav, (args) => {
      argv = args;
      writeTxt(args, "  hi there \n");
      return { status: 0 };
    });
    expect(text).toBe("hi there");
    expect(argv.slice(0, 4)).toStrictEqual(["-m", "/m.bin", "-f", wav]);
    expect(fs.readdirSync(path.dirname(wav))).toStrictEqual(["a.wav"]);
  });
});

describe("transcribeLocal fallbacks", () => {
  it("falls back to stdout when the .txt is empty or absent", () => {
    const wav = wavIn("listen-tl2-");
    expect(localRun(wav, blank)).toBe("from stdout");
    expect(localRun(wav, { status: 0, stdout: Buffer.from("buf out") })).toBe("buf out");
  });

  it("throws the binary's stderr, or a default, when there is no text", () => {
    const wav = wavIn("listen-tl3-");
    expect(() => localRun(wav, { status: 1, stderr: "model corrupt" })).toThrow("model corrupt");
    expect(() => localRun(wav, { status: 1 })).toThrow("whisper-cli failed");
  });
});

/** A whisper run that writes a blank .txt and prints to stdout. */
function blank(args: string[]): SpawnSyncResult {
  writeTxt(args, "  \n");
  return { status: 0, stdout: " from stdout " };
}

/** A spawnSync that must never run. */
function noSpawn(): never {
  throw new Error("no spawn");
}

/** An HTTP failure with `status` and the body `text`. */
function body(status: number, text: string) {
  return reply({ ok: false, status, text: () => Promise.resolve(text) });
}

function transcribeWith(over: Partial<Parameters<typeof transcribe>[0]>) {
  const cfg = { ...cfgFor(tmp("listen-tr-h-"), { OPENAI_API_KEY: "sk" }), model: "m-1" };
  const file = wavIn("listen-tr-");
  const stt: Stt = { kind: "openai", model: "m-1" };
  return transcribe({ cfg, fetchFn: jsonReply({}), file, spawnSyncFn: noSpawn, stt, ...over });
}

describe("transcribe request", () => {
  it("rejects a missing file", async () => {
    await expect(transcribeWith({ file: "/nonexistent/x.wav" })).rejects.toThrow("transcribe needs an audio file");
  });

  it("routes a local engine to the binary", async () => {
    const out = await transcribeWith({
      spawnSyncFn: () => ({ status: 0, stdout: "local text" }),
      stt: { bin: "w", kind: "local", model: "/m" },
    });
    expect(out).toBe("local text");
  });

  it("needs a key for the API", async () => {
    const cfg = cfgFor(tmp("listen-tr-nokey-"));
    await expect(transcribeWith({ cfg })).rejects.toThrow(NEED_STT);
  });

  it("posts the file and the configured model", async () => {
    const bodies: Array<FormData | undefined> = [];
    function fetchFn(url: string, init: Parameters<FetchFn>[1]): ReturnType<FetchFn> {
      bodies.push(init.body);
      return jsonReply({ text: "t" })(url, init);
    }
    await transcribeWith({ fetchFn });
    const file = bodies[0]?.get("file");
    expect(bodies[0]?.get("model")).toBe("m-1");
    expect(file instanceof File && file.name).toBe("a.wav");
  });
});

describe("transcribe response", () => {
  it("reads text from a record, a bare string, or yields an empty transcript", async () => {
    expect(await transcribeWith({ fetchFn: jsonReply({ text: " a " }) })).toBe("a");
    expect(await transcribeWith({ fetchFn: jsonReply("plain") })).toBe("plain");
    expect(await transcribeWith({ fetchFn: jsonReply(7) })).toBe("");
    expect(await transcribeWith({ fetchFn: reply({ ok: true }) })).toBe("");
  });

  it("turns an HTTP failure into an error with the status and body", async () => {
    await expect(transcribeWith({ fetchFn: body(500, "boom") })).rejects.toThrow("500 boom");
    await expect(transcribeWith({ fetchFn: body(401, "no") })).rejects.toThrow(/rejected \(401\)/);
    await expect(transcribeWith({ fetchFn: reply({ ok: false }) })).rejects.toThrow("err");
  });

  it("still reports the status when the body cannot be read", async () => {
    const unreadable = reply({ ok: false, status: 502, text: () => Promise.reject(new Error("stream")) });
    await expect(transcribeWith({ fetchFn: unreadable })).rejects.toThrow("502");
  });
});
