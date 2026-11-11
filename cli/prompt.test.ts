import { afterEach, describe, expect, it, vi } from "vitest";

const clackSelect = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const clackConfirm = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const clackText = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const clackPassword = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const clackSpinner = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const clackIsCancel = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const clackCancel = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());

vi.mock("@clack/prompts", () => ({
  cancel: clackCancel,
  confirm: clackConfirm,
  isCancel: clackIsCancel,
  password: clackPassword,
  select: clackSelect,
  spinner: clackSpinner,
  text: clackText,
}));

import { bailIfCancel, confirm, isInteractive, password, select, spinner, text } from "./prompt.ts";

type Stream = NodeJS.ReadStream & NodeJS.WriteStream;
function tty(): Stream {
  return { isTTY: true } /* isInteractive reads only isTTY */ as Stream;
}
function notTty(): Stream {
  return { isTTY: false } /* isInteractive reads only isTTY */ as Stream;
}

function interactive(over: Partial<NonNullable<Parameters<typeof isInteractive>[0]>> = {}) {
  return isInteractive({ argv: [], env: {}, stdin: tty(), stdout: tty(), ...over });
}

describe("isInteractive", () => {
  it("true when both TTY, CI unset, no yes flags", () => {
    expect(interactive()).toBe(true);
  });

  it("true when CI is 0 or false or empty", () => {
    for (const ci of ["0", "false", ""]) expect(interactive({ env: { CI: ci } })).toBe(true);
  });

  it("false when stdin not TTY", () => {
    expect(interactive({ stdin: notTty() })).toBe(false);
  });

  it("false when stdout not TTY", () => {
    expect(interactive({ stdout: notTty() })).toBe(false);
  });

  it("false when stdin isTTY missing", () => {
    expect(interactive({ stdin: {} })).toBe(false);
  });

  it.each(["1", "true", "yes", "CI"])("false when CI=%s", (ci) => {
    expect(interactive({ env: { CI: ci } })).toBe(false);
  });

  it.each(["--yes", "-y", "--non-interactive"])("false when argv has %s", (flag) => {
    expect(interactive({ argv: [flag] })).toBe(false);
  });
});

function restoreIsTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream, desc: PropertyDescriptor | undefined) {
  if (desc === undefined) Reflect.deleteProperty(stream, "isTTY");
  else Object.defineProperty(stream, "isTTY", desc);
}

describe("isInteractive", () => {
  it("uses process defaults", () => {
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const argv = process.argv;
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    process.argv = ["node", "repo"];
    vi.stubEnv("CI", undefined);
    try {
      expect(isInteractive()).toBe(true);
      process.argv = ["node", "repo", "--yes"];
      expect(isInteractive()).toBe(false);
    } finally {
      process.argv = argv;
      restoreIsTTY(process.stdin, stdinDesc);
      restoreIsTTY(process.stdout, stdoutDesc);
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
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });
    expect(() => bailIfCancel(Symbol("cancel"))).toThrow("EXIT");
    expect(clackCancel).toHaveBeenCalledWith("Aborted");
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });
});

/** Clears the clack mocks a wrapper test sets. */
function resetClack(): void {
  clackSelect.mockReset();
  clackConfirm.mockReset();
  clackSpinner.mockReset();
  clackIsCancel.mockReset();
  clackCancel.mockReset();
}

describe("clack wrappers", () => {
  afterEach(resetClack);

  it("select bails then returns", async () => {
    clackSelect.mockResolvedValue("init");
    clackIsCancel.mockReturnValue(false);
    await expect(
      select({ message: "Command" } /* the mocked select reads no options */ as Parameters<typeof select>[0]),
    ).resolves.toBe("init");
    expect(clackSelect).toHaveBeenCalledWith({ message: "Command" });
  });

  it("confirm bails then returns", async () => {
    clackConfirm.mockResolvedValue(true);
    clackIsCancel.mockReturnValue(false);
    await expect(confirm({ message: "Re-init?" })).resolves.toBe(true);
    expect(clackConfirm).toHaveBeenCalledWith({ message: "Re-init?" });
  });
});

describe("clack wrappers", () => {
  afterEach(resetClack);
  it("select cancel exits 0", async () => {
    clackSelect.mockResolvedValue("x");
    clackIsCancel.mockReturnValue(true);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });
    await expect(select({} /* the mocked select reads no options */ as Parameters<typeof select>[0])).rejects.toThrow(
      "EXIT",
    );
    expect(clackCancel).toHaveBeenCalledWith("Aborted");
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });
});

describe("clack wrappers", () => {
  afterEach(resetClack);
  it("spinner passthrough", () => {
    const s = { start: vi.fn<() => void>(), stop: vi.fn<() => void>() };
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
