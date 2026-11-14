import { vi } from "vitest";

import type { HookIo } from "../hook-io.ts";
import { main } from "../persist.ts";

/** An io that hands `body` out in 100-byte chunks, then reports the stream closed; `out` collects stdout. */
export function fakeIo(body: string) {
  const bytes = Buffer.from(body, "utf8");
  let at = 0;
  const out: string[] = [];

  const io: HookIo = {
    readChunk: () => {
      if (at >= bytes.length) return null;
      const chunk = bytes.subarray(at, at + 100);
      at += 100;

      return chunk;
    },
    write: (text) => {
      out.push(text);
    },
  };

  return { io, out };
}

/** Runs `main`, capturing what it writes to stderr. */
export async function run(argv: string[], body = "") {
  const { io, out } = fakeIo(body);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const code = await main(argv, io);
  const stderr = err.mock.calls.map((c) => String(c[0])).join("");

  return { code, stderr, stdout: out.join("") };
}
