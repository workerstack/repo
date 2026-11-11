import { expect, it, vi } from "vitest";

const fakes = await vi.hoisted(() => import("./fixtures/main-mocks.ts").then((mocks) => mocks.mockedMainFakes()));
import { USAGE, anyFunction, useStart } from "./fixtures/main-kit.ts";
import { APPLY_GLOBALS_CONFIRM, start } from "./main.ts";

const written = useStart(fakes);
const { confirm, init, isInteractive, runCommand, select, spinner } = fakes;

const MENU = ["init", "check", "yolo", "purge-mcps", "doctor", "clean", "setup", "tasks", "help", "quit"];

/** A TTY run of `repo` with `args`. */
async function startTty(...args: string[]): Promise<void> {
  isInteractive.mockReturnValue(true);
  process.argv = ["node", "repo", ...args];
  await start();
}

it("TTY menu runs a registry command in-process", async () => {
  select.mockResolvedValue("doctor");
  await startTty();
  expect(runCommand).toHaveBeenCalledWith("doctor", []);
});

it("TTY no cmd shows menu default init", async () => {
  select.mockResolvedValue("init");
  confirm.mockResolvedValue(true);
  await startTty();
  expect(select).toHaveBeenCalledOnce();
  expect(select.mock.calls[0]?.[0].initialValue).toBe("init");
  expect(select.mock.calls[0]?.[0].options.map((o) => o.value)).toStrictEqual(MENU);
  expect(init).toHaveBeenCalledWith(process.cwd(), expect.objectContaining({ skipGlobals: false }));
  expect(isInteractive).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledWith({ initialValue: true, message: APPLY_GLOBALS_CONFIRM });
});

it("TTY menu help writes usage", async () => {
  select.mockResolvedValue("help");
  await startTty();
  expect(written.out.join("")).toBe(USAGE);
  expect(process.exitCode).toBe(0);
});

it("TTY menu quit does nothing", async () => {
  select.mockResolvedValue("quit");
  await startTty();
  expect(init).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(0);
});

it("TTY cancel exits 0", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("EXIT");
  });
  select.mockImplementation(() => process.exit(0));
  await expect(startTty()).rejects.toThrow("EXIT");
  expect(exit).toHaveBeenCalledWith(0);
  expect(init).not.toHaveBeenCalled();
});

it("TTY init confirms globals; spinner onPhase stop before inherit", async () => {
  const spin = { start: vi.fn<(name: string) => void>(), stop: vi.fn<(name: string) => void>() };
  spinner.mockReturnValue(spin);
  confirm.mockResolvedValue(true);
  init.mockImplementation((_dest, opts) => {
    for (const name of ["merge", "install"]) {
      opts.onPhase?.(name, "start");
      opts.onPhase?.(name, "stop");
    }
  });
  await startTty("init");
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: APPLY_GLOBALS_CONFIRM }));
  const globalsConfirm = confirm.mock.calls.find((c) => c[0].message === APPLY_GLOBALS_CONFIRM);
  expect(globalsConfirm?.[0]).toMatchObject({ initialValue: true, message: APPLY_GLOBALS_CONFIRM });
  expect(init).toHaveBeenCalledWith(
    process.cwd(),
    expect.objectContaining({ onPhase: anyFunction(), skipGlobals: false }),
  );
  expect(isInteractive).toHaveBeenCalledOnce();
  for (const name of ["merge", "install"]) {
    expect(spin.start).toHaveBeenCalledWith(name);
    expect(spin.stop).toHaveBeenCalledWith(name);
  }
});

it("TTY init --skip-globals default confirm false maps to skip", async () => {
  confirm.mockResolvedValue(false);
  await startTty("init", "--skip-globals");
  expect(confirm).toHaveBeenCalledWith({ initialValue: false, message: APPLY_GLOBALS_CONFIRM });
  expect(init).toHaveBeenCalledWith(
    process.cwd(),
    expect.objectContaining({ onPhase: anyFunction(), skipGlobals: true }),
  );
  expect(isInteractive).toHaveBeenCalledOnce();
});

it("TTY init passes --packs to init", async () => {
  confirm.mockResolvedValue(true);
  await startTty("init", "--packs", "listen");
  expect(init).toHaveBeenCalledWith(process.cwd(), expect.objectContaining({ packs: ["listen"], skipGlobals: false }));
});
