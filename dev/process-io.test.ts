import { afterEach, expect, it, vi } from "vitest";

import { processIo } from "./process-io.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

it("writes each line with a newline to stdout or stderr", () => {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  processIo.out("a");
  processIo.err("b");
  expect(out).toHaveBeenCalledWith("a\n");
  expect(err).toHaveBeenCalledWith("b\n");
});
