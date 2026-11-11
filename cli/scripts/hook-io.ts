/** The edge every hook reads its payload from and writes its reply to; tests pass a fake in place of the process. */
import fs from "node:fs";

import { parseHookInput, type HookInput } from "./hook-input.ts";
import { HOOK_READ_CHUNK_BYTES, STDIN_FD } from "./hook-io.constants.ts";

export interface HookIo {
  /** The next bytes of the payload; null once the stream is closed or unreadable. */
  readChunk(): Uint8Array | null;
  write(text: string): void;
}

/** Reads `fd` (stdin unless a test plants a file) and writes stdout. */
export function processHookIo(fd: number = STDIN_FD): HookIo {
  const chunk = Buffer.alloc(HOOK_READ_CHUNK_BYTES);
  return {
    readChunk: () => {
      try {
        const n = fs.readSync(fd, chunk, 0, chunk.length, null);
        return n === 0 ? null : chunk.subarray(0, n);
      } catch {
        return null;
      }
    },
    write: (text) => {
      process.stdout.write(text);
    },
  };
}

/** Read until the bytes parse as one JSON object, without waiting for EOF (some hosts keep stdin open); null when they never do. */
export function readHookInput(io: HookIo): HookInput | null {
  let buf = Buffer.alloc(0);
  for (let chunk = io.readChunk(); chunk; chunk = io.readChunk()) {
    buf = Buffer.concat([buf, chunk]);
    const parsed = parseHookInput(buf.toString("utf8"));
    if (parsed) return parsed;
  }
  return null;
}

/** Read to EOF and decode as utf8, for a body such as markdown that is never one JSON object. */
export function readAllText(io: HookIo): string {
  const chunks: Uint8Array[] = [];
  for (let chunk = io.readChunk(); chunk; chunk = io.readChunk()) chunks.push(Uint8Array.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
