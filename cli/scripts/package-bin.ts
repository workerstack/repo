import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { packageJsonSchema } from "../package-json.ts";

function binSchema() {
  return packageJsonSchema.pick({}).extend({ bin: z.record(z.string(), z.string()).optional() });
}

/** The bin script `name` the package.json at `manifest` declares, as a path beside that manifest. */
export function packageBin(manifest: string, name: string): string {
  const bin = tryJson(binSchema(), fs.readFileSync(manifest, "utf8"))?.bin?.[name];

  if (bin === undefined) throw new Error(`${manifest} declares no bin ${name}`);

  return path.join(path.dirname(manifest), bin);
}
