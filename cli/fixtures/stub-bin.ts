import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bunPath } from "../../dev/test-paths.ts";

/**
 * Plants a command `name` in `dir` that a product starts by name or from PATH: an executable shebang script
 * with `sh` as its body, or on win32 `name.cmd` with `cmd` as its batch body (a shebang script cannot start there).
 * Returns the file written.
 */
export function plantStub(dir: string, name: string, body: { sh: string; cmd: string }): string {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    const file = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(file, `@echo off\r\n${body.cmd.replaceAll("\n", "\r\n")}`);
    return file;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body.sh}`, { mode: 0o755 });
  return file;
}

/**
 * Plants a command `name` in `dir` that a product starts by its path without a shell, so a `.cmd` will not do on
 * win32: the `js` program, as a shebang script run by bun, or on win32 compiled to `name.exe`. Returns the file.
 */
export function plantProgram(dir: string, name: string, js: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, `${name}-source.js`);
  fs.writeFileSync(source, js);
  if (process.platform === "win32") {
    const file = path.join(dir, `${name}.exe`);
    const built = spawnSync(bunPath(), ["build", "--compile", source, "--outfile", file], { encoding: "utf8" });
    if (built.status !== 0) throw new Error(`bun build --compile failed: ${built.stderr}${built.stdout}`);
    return file;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nexec ${JSON.stringify(bunPath())} ${JSON.stringify(source)} "$@"\n`, { mode: 0o755 });
  return file;
}
