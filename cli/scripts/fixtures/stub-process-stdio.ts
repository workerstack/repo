/** A hook's real process stdio, stubbed: stdin yields one JSON payload and stdout is captured. */
import fs from "node:fs";

import { vi } from "vitest";

/** The next stdin read yields `payload` as JSON; returns a reader of the first chunk written to stdout. */
export function stubProcessStdio(payload: unknown): () => string {
  const bytes = Buffer.from(JSON.stringify(payload));
  vi.spyOn(fs, "readSync").mockImplementationOnce((_fd, into) =>
    bytes.copy(new Uint8Array(into.buffer, into.byteOffset, into.byteLength)),
  );
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return () => String(out.mock.calls[0]?.[0]);
}
