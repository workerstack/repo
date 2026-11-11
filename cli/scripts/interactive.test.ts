import { describe, expect, it } from "vitest";

import { isInteractive } from "./interactive.ts";

const tty = { isTTY: true };

describe("isInteractive", () => {
  it("is true on two TTYs with CI unset and no opt-out flag", () => {
    expect(isInteractive({ argv: [], env: {}, stdin: tty, stdout: tty })).toBe(true);
    expect(isInteractive({ argv: ["--other"], env: { CI: "" }, stdin: tty, stdout: tty })).toBe(true);
  });

  it("is false when either stream is not a TTY", () => {
    expect(isInteractive({ argv: [], env: {}, stdin: {}, stdout: tty })).toBe(false);
    expect(isInteractive({ argv: [], env: {}, stdin: tty, stdout: { isTTY: false } })).toBe(false);
  });

  it("is false when CI is set to anything but empty, 0 or false", () => {
    expect(isInteractive({ argv: [], env: { CI: "1" }, stdin: tty, stdout: tty })).toBe(false);
    expect(isInteractive({ argv: [], env: { CI: "true" }, stdin: tty, stdout: tty })).toBe(false);
    expect(isInteractive({ argv: [], env: { CI: "0" }, stdin: tty, stdout: tty })).toBe(true);
    expect(isInteractive({ argv: [], env: { CI: "false" }, stdin: tty, stdout: tty })).toBe(true);
  });

  it.each(["--yes", "-y", "--non-interactive"])("is false with %s among the arguments", (flag) => {
    expect(isInteractive({ argv: ["go", flag], env: {}, stdin: tty, stdout: tty })).toBe(false);
  });

  it("reads the process streams, env and arguments by default, and a test run has no TTY", () => {
    expect(isInteractive()).toBe(false);
  });
});
