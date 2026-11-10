import fs from "node:fs";
import path from "node:path";

/** The entries under `dir` (two levels deep) with each mode and flags, for the message of a dir that would not go. */
export function describeLeftOver(dir: string): string {
  const row = (p: string) => {
    try {
      const st = fs.lstatSync(p);
      const flags = (st as { flags?: number }).flags;
      return `${path.relative(dir, p) || "."} mode=${st.mode.toString(8)}${flags === undefined ? "" : ` flags=${flags}`}`;
    } catch (error) {
      return `${p} (${(error as Error).message})`;
    }
  };
  try {
    const rows = [row(dir)];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      rows.push(row(p));
      if (e.isDirectory()) for (const n of fs.readdirSync(p)) rows.push(row(path.join(p, n)));
    }
    return rows.slice(0, 40).join("; ") || "(empty dir)";
  } catch (error) {
    return (error as Error).message;
  }
}

/** How many times a removal is started when `rm` throws ENOENT for an entry that vanished mid-walk while `x` is still there. */
const REMOVE_ATTEMPTS = 5;

/** Removes `x` without `force`, so a failure keeps its code and path, and throws what was last caught plus what is left. */
export function removeOrExplain(x: string, rm: typeof fs.rmSync = fs.rmSync): void {
  let caught = "";
  for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt++) {
    try {
      rm(x, { recursive: true, maxRetries: 10, retryDelay: 50 });
      caught = "";
      break;
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      caught = `${e.code ?? ""} ${e.message} (path ${e.path ?? "?"})`;
      if (e.code !== "ENOENT" || !fs.existsSync(x)) break;
    }
  }
  if (fs.existsSync(x)) throw new Error(`could not remove ${x}; rmSync: ${caught || "returned without error"}; left: ${describeLeftOver(x)}`);
}
