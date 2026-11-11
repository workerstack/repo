import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HOOK_READ_CHUNK_BYTES } from "./hook-io.constants.ts";
import { processHookIo, readAllText, readHookInput, type HookIo } from "./hook-io.ts";

const encoder = new TextEncoder();

/** An io that hands out `chunks` in order, then reports the stream closed; `written` collects the replies. */
function fakeIo(chunks: string[]): { io: HookIo; written: string[]; reads: () => number } {
  const written: string[] = [];
  let reads = 0;
  const io: HookIo = {
    readChunk: () => {
      const next = chunks[reads++];
      return next === undefined ? null : encoder.encode(next);
    },
    write: (text) => {
      written.push(text);
    },
  };
  return { io, reads: () => reads, written };
}

describe("readAllText", () => {
  it("joins the chunks to the end of the stream, keeping a multibyte character a boundary splits", () => {
    const bytes = encoder.encode("# tmp\nnaïve é\n");
    const cut = bytes.indexOf(0xc3) + 1;
    const chunks = [bytes.subarray(0, cut), bytes.subarray(cut)];
    let i = 0;
    const io: HookIo = { readChunk: () => chunks[i++] ?? null, write: () => {} };
    expect(readAllText(io)).toBe("# tmp\nnaïve é\n");
  });

  it("reads an empty stream as the empty string", () => {
    expect(readAllText(fakeIo([]).io)).toBe("");
  });
});

describe("readHookInput", () => {
  it("parses a payload split over chunks once it is whole", () => {
    const json = JSON.stringify({ cwd: "/repo", session_id: "s1" });
    const { io } = fakeIo([json.slice(0, 5), json.slice(5, 12), json.slice(12)]);
    expect(readHookInput(io)).toStrictEqual({ cwd: "/repo", session_id: "s1" });
  });

  it("returns the first whole payload without waiting for the stream to close", () => {
    const never = fakeIo([JSON.stringify({ session_id: "s1" }), "ignored: the host keeps stdin open"]);
    expect(readHookInput(never.io)).toStrictEqual({ session_id: "s1" });
    expect(never.reads()).toBe(1);
  });

  it("keeps a multibyte character that a chunk boundary splits", () => {
    const bytes = encoder.encode(JSON.stringify({ prompt: "é" }));
    const cut = bytes.indexOf(0xc3) + 1;
    const chunks = [bytes.subarray(0, cut), bytes.subarray(cut)];
    let at = 0;
    const io: HookIo = { readChunk: () => chunks[at++] ?? null, write: () => undefined };
    expect(readHookInput(io)).toStrictEqual({ prompt: "é" });
  });

  it("gives null for empty input", () => {
    expect(readHookInput(fakeIo([]).io)).toBeNull();
  });

  it("gives null for junk and for a payload that is not an object", () => {
    expect(readHookInput(fakeIo(["not json"]).io)).toBeNull();
    expect(readHookInput(fakeIo(["[1,2]"]).io)).toBeNull();
  });
});

describe("HookIo.write", () => {
  it("reaches the sink", () => {
    const { io, written } = fakeIo([]);
    io.write("reply");
    expect(written).toStrictEqual(["reply"]);
  });
});

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
  vi.restoreAllMocks();
});

/** Opens a planted file holding `text` and returns its fd; the temp dir is removed after the test. */
function plantedFd(text: string): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-io-"));
  tmpDirs.push(dir);
  const file = path.join(dir, "payload.json");
  fs.writeFileSync(file, text);
  const fd = fs.openSync(file, "r");
  openFds.push(fd);
  return fd;
}

const openFds: number[] = [];
afterEach(() => {
  for (const fd of openFds.splice(0)) fs.closeSync(fd);
});

describe("processHookIo", () => {
  it("reads a payload from the descriptor and reports the end as null", () => {
    const io = processHookIo(plantedFd(JSON.stringify({ session_id: "s9" })));
    expect(readHookInput(io)).toStrictEqual({ session_id: "s9" });
    expect(io.readChunk()).toBeNull();
  });

  it("hands a payload larger than one read over in several chunks", () => {
    const text = JSON.stringify({ prompt: "x".repeat(HOOK_READ_CHUNK_BYTES * 2 + 10) });
    const io = processHookIo(plantedFd(text));
    expect(readHookInput(io)).toStrictEqual({ prompt: "x".repeat(HOOK_READ_CHUNK_BYTES * 2 + 10) });
  });

  it("reads null from a descriptor that is not open", () => {
    const fd = plantedFd("{}");
    fs.closeSync(fd);
    openFds.splice(openFds.indexOf(fd), 1);
    expect(processHookIo(fd).readChunk()).toBeNull();
  });

  it("writes the reply to stdout", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    processHookIo().write("reply");
    expect(out).toHaveBeenCalledWith("reply");
  });
});
