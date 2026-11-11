import { parse, type ParseError } from "jsonc-parser";

import { type Pack, type ResolvedLint } from "../../config.ts";
import { BASE_CONFIG } from "../../__fixtures__/base-config.ts";
import type { Output, SyncContext } from "../outputs.ts";

/** A sync context of `packs` for a workspace named `name`, with nothing on disk. */
export function context(packs: Pack[], name = "app", lint: ResolvedLint = { skip: [] }): SyncContext {
  return {
    config: {
      agents: { hosts: [], skills: [] },
      packs,
      ...BASE_CONFIG,
      lint,
    },
    read: () => null,
    root: "/repo",
    workspace: { manifest: { name }, packages: [], root: "/repo" },
  };
}

/** A planned file output at `rel`. */
export function file(rel: string, { managed = "whole", tracked }: { managed?: Output["managed"]; tracked: boolean }): Output {
  return {
    content: "x\n",
    kind: "file",
    managed,
    path: rel,
    tracked,
  };
}
/** A planned link output at `rel`. */
export function link(rel: string, { tracked }: { tracked: boolean }): Output {
  return {
    kind: "link",
    managed: "whole",
    path: rel,
    target: "../x",
    tracked,
  };
}

/** The parsed JSONC content of the file output at `rel`. */
export function contentOf(outputs: readonly Output[], rel: string): unknown {
  const found = outputs.find((output) => output.path === rel);
  if (found?.kind !== "file") throw new Error(`no file output ${rel}`);
  const errors: ParseError[] = [];
  const value: unknown = parse(found.content, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`${rel} does not parse`);
  return value;
}
