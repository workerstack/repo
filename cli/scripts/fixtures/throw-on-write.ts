/** A command's stdout that fails: every write throws the given value. */
import { vi } from "vitest";

/** Makes each stdout write throw `thrown`, as a closed pipe does. */
export function throwOnWrite(thrown: unknown): void {
  vi.spyOn(process.stdout, "write").mockImplementation(() => {
    throw thrown;
  });
}
