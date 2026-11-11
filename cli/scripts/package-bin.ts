import fs from "node:fs";
import path from "node:path";

import { isRecord } from "./hook-input.ts";

/** The bin script `name` the package.json at `manifest` declares, as a path beside that manifest. */
export function packageBin(manifest: string, name: string): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const bin = isRecord(parsed) && isRecord(parsed.bin) ? parsed.bin[name] : undefined;
  if (typeof bin !== "string") throw new Error(`${manifest} declares no bin ${name}`);
  return path.join(path.dirname(manifest), bin);
}
