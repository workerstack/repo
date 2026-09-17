import { afterEach, describe, expect, it, vi } from "vitest";

const clackSelect = vi.hoisted(() => vi.fn());
const clackConfirm = vi.hoisted(() => vi.fn());
const clackText = vi.hoisted(() => vi.fn());
const clackPassword = vi.hoisted(() => vi.fn());
const clackSpinner = vi.hoisted(() => vi.fn());
const clackIsCancel = vi.hoisted(() => vi.fn());
const clackCancel = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
  select: clackSelect,
  confirm: clackConfirm,
  text: clackText,
  password: clackPassword,
  spinner: clackSpinner,
  isCancel: clackIsCancel,
  cancel: clackCancel,
}));

import {
  bailIfCancel,
  confirm,
  isInteractive,
  password,
  select,
  spinner,
  text,
} from "./prompt.mjs";

function tty(isTTY: boolean) {
  return { isTTY } as NodeJS.ReadStream & NodeJS.WriteStream;
}

describe("isInteractive", () => {
  it("true when both TTY, CI unset, no yes flags", () => {
    expect(
      isInteractive({
        argv: [],
        env: {},
        stdin: tty(true),
        stdout: tty(true),
      }),
    ).toBe(true);
  });

  it("true when CI is 0 or false or empty", () => {
    for (const CI of ["0", "false", ""]) {
      expect(
        isInteractive({
          argv: [],
          env: { CI },
          stdin: tty(true),
          stdout: tty(true),
        }),
      ).toBe(true);
    }
  });

  it("false when stdin not TTY", () => {
    expect(
      isInteractive({
        argv: [],
        env: {},
        stdin: tty(false),
        stdout: tty(true),
      }),
    ).toBe(false);
  });

  it("false when stdout not TTY", () => {
    expect(
      isInteractive({
        argv: [],
        env: {},
        stdin: tty(true),
        stdout: tty(false),
      }),
    ).toBe(false);
  });

  it("false when stdin isTTY missing", () => {
    expect(
      isInteractive({
        argv: [],
        env: {},
        stdin: {} as NodeJS.ReadStream,
        stdout: tty(true),
      }),
    ).toBe(false);
  });

  it.each(["1", "true", "yes", "CI"])("false when CI=%s", (CI) => {
    expect(
      isInteractive({
        argv: [],
        env: { CI },
        stdin: tty(true),
        stdout: tty(true),
      }),
    ).toBe(false);
  });

  it.each(["--yes", "-y", "--non-interactive"])("false when argv has %s", (flag) => {
    expect(
      isInteractive({
        argv: [flag],
        env: {},
        stdin: tty(true),
        stdout: tty(true),
      }),
    ).toBe(false);
  });

  it("uses process defaults", () => {
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const argv = process.argv;
    const ci = process.env.CI;
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    process.argv = ["node", "grunt"];
    delete process.env.CI;
    try {
      expect(isInteractive()).toBe(true);
      process.argv = ["node", "grunt", "--yes"];
      expect(isInteractive()).toBe(false);
    } finally {
      process.argv = argv;
      if (ci === undefined) delete process.env.CI;
      else process.env.CI = ci;
      if (stdinDesc) Object.defineProperty(process.stdin, "isTTY", stdinDesc);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
      if (stdoutDesc) Object.defineProperty(process.stdout, "isTTY", stdoutDesc);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });
});

describe("bailIfCancel", () => {
  afterEach(() => {
    clackIsCancel.mockReset();
    clackCancel.mockReset();
  });

  it("returns value when not cancel", () => {
    clackIsCancel.mockReturnValue(false);
    expect(bailIfCancel("ok")).toBe("ok");
    expect(clackCancel).not.toHaveBeenCalled();
  });

  it("cancel Aborted and exit 0", () => {
    clackIsCancel.mockReturnValue(true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("EXIT");
    }) as typeof process.exit);
    expect(() => bailIfCancel(Symbol("cancel"))).toThrow("EXIT");
    expect(clackCancel).toHaveBeenCalledWith("Aborted");
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });
});

describe("clack wrappers", () => {
  afterEach(() => {
    clackSelect.mockReset();
    clackConfirm.mockReset();
    clackSpinner.mockReset();
    clackIsCancel.mockReset();
    clackCancel.mockReset();
  });

  it("select bails then returns", async () => {
    clackSelect.mockResolvedValue("init");
    clackIsCancel.mockReturnValue(false);
    await expect(select({ message: "Command" })).resolves.toBe("init");
    expect(clackSelect).toHaveBeenCalledWith({ message: "Command" });
  });

  it("confirm bails then returns", async () => {
    clackConfirm.mockResolvedValue(true);
    clackIsCancel.mockReturnValue(false);
    await expect(confirm({ message: "Re-init?" })).resolves.toBe(true);
    expect(clackConfirm).toHaveBeenCalledWith({ message: "Re-init?" });
  });

  it("select cancel exits 0", async () => {
    clackSelect.mockResolvedValue("x");
    clackIsCancel.mockReturnValue(true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("EXIT");
    }) as typeof process.exit);
    await expect(select({})).rejects.toThrow("EXIT");
    expect(clackCancel).toHaveBeenCalledWith("Aborted");
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });

  it("spinner passthrough", () => {
    const s = { start: vi.fn(), stop: vi.fn() };
    clackSpinner.mockReturnValue(s);
    expect(spinner()).toBe(s);
    expect(clackSpinner).toHaveBeenCalledOnce();
  });

  it("text and password bail then return", async () => {
    clackText.mockResolvedValue("proj");
    clackPassword.mockResolvedValue("sk_x");
    clackIsCancel.mockReturnValue(false);
    await expect(text({ message: "Project ID" })).resolves.toBe("proj");
    await expect(password({ message: "API key" })).resolves.toBe("sk_x");
  });
});
