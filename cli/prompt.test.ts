import { describe, expect, it, vi } from "vitest";

import { bailIfCancel, confirm, isInteractive, password, select, spinner, text } from "./prompt.ts";
import { promptsOf, type Clack } from "./scripts/prompt.ts";

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

/** A clack whose every call is a fake; `isCancel` says no unless a test says yes. */
function fakeClack() {
  return {
    cancel: vi.fn<Clack["cancel"]>(),
    confirm: vi.fn<Clack["confirm"]>(),
    isCancel: vi.fn<(value: unknown) => boolean>(() => false),
    password: vi.fn<Clack["password"]>(),
    // The menu's every call; the fake picks its first option.
    select: vi.fn<(opts: unknown) => void>(),
    spinner: vi.fn<Clack["spinner"]>(),
    text: vi.fn<Clack["text"]>(),
  };
}

type FakeClack = ReturnType<typeof fakeClack>;

/** The prompts over `fake`: its `isCancel` read as clack's guard, its select picking the first option. */
function promptsOver(fake: FakeClack) {
  return promptsOf({
    ...fake,
    isCancel: (value): value is symbol => fake.isCancel(value),
    select: <Value>(opts: { options: { value: Value }[] }): Promise<Value | symbol> => {
      fake.select(opts);

      return Promise.resolve(opts.options.at(0)?.value ?? Symbol("no option"));
    },
  });
}

/** `process.exit` throwing `EXIT`, so a cancel stops the test where the CLI would stop. */
function spyExit() {
  return vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("EXIT");
  });
}

describe("bailIfCancel", () => {
  it("returns value when not cancel", () => {
    const fake = fakeClack();
    expect(promptsOver(fake).bailIfCancel("ok")).toBe("ok");
    expect(fake.cancel).not.toHaveBeenCalled();
  });

  it("cancel Aborted and exit 0", () => {
    const fake = fakeClack();
    fake.isCancel.mockReturnValue(true);
    const exit = spyExit();

    expect(() => promptsOver(fake).bailIfCancel(Symbol("cancel"))).toThrow("EXIT");
    expect(fake.cancel).toHaveBeenCalledWith("Aborted");
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });
});

const MENU = { message: "Command", options: [{ value: "init" }] };

describe("clack wrappers", () => {
  it("select bails then returns", async () => {
    const fake = fakeClack();
    await expect(promptsOver(fake).select(MENU)).resolves.toBe("init");
    expect(fake.select).toHaveBeenCalledWith(MENU);
  });

  it("confirm bails then returns", async () => {
    const fake = fakeClack();
    fake.confirm.mockResolvedValue(true);
    await expect(promptsOver(fake).confirm({ message: "Re-init?" })).resolves.toBe(true);
    expect(fake.confirm).toHaveBeenCalledWith({ message: "Re-init?" });
  });
});

describe("clack wrappers", () => {
  it("select cancel exits 0", async () => {
    const fake = fakeClack();
    fake.isCancel.mockReturnValue(true);
    const exit = spyExit();

    await expect(promptsOver(fake).select(MENU)).rejects.toThrow("EXIT");
    expect(fake.cancel).toHaveBeenCalledWith("Aborted");
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });

  it("spinner passthrough", () => {
    const fake = fakeClack();
    const s = { message: vi.fn<() => void>(), start: vi.fn<() => void>(), stop: vi.fn<() => void>() };
    fake.spinner.mockReturnValue(s);
    expect(promptsOver(fake).spinner()).toBe(s);
    expect(fake.spinner).toHaveBeenCalledOnce();
  });

  it("text and password bail then return", async () => {
    const fake = fakeClack();
    fake.text.mockResolvedValue("proj");
    fake.password.mockResolvedValue("sk_x");
    await expect(promptsOver(fake).text({ message: "Project ID" })).resolves.toBe("proj");
    await expect(promptsOver(fake).password({ message: "API key" })).resolves.toBe("sk_x");
  });
});

/** One key on stdin, where clack's prompts read it. */
function press(name: string, sequence: string = ""): void {
  process.stdin.emit("keypress", sequence, { name, sequence });
}

/** Each named prompt asked in turn, its keys pressed as it waits; what each one answered. */
async function answerEach(): Promise<unknown[]> {
  const confirmed = confirm({ message: "Re-init?" });
  press("return");
  const picked = select({ message: "Command", options: [{ value: "init" }, { value: "check" }] });
  press("down");
  press("return");
  const typed = text({ message: "Project ID" });
  press("p", "p");
  press("return");
  const secret = password({ message: "API key" });
  press("k", "k");
  press("return");

  return [await confirmed, await picked, await typed, await secret];
}

describe("the named prompts", () => {
  it("run on @clack/prompts itself", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      expect(await answerEach()).toStrictEqual([true, "check", "p", "k"]);
      expect(bailIfCancel("ok")).toBe("ok");
      expect(Object.keys(spinner())).toStrictEqual(expect.arrayContaining(["message", "start", "stop"]));
    } finally {
      write.mockRestore();
    }
  });
});
