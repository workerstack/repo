/** The `link` section of repo.config.ts: the checkouts `repo link` packs from, and what the push check does. */
import { z } from "zod";

import {
  DEFAULT_LINK_PUSH,
  LINK_OBJECT_ERROR,
  LINK_PATHS_ERROR,
  LINK_PATH_ERROR,
  LINK_PUSH,
  LINK_PUSH_ERROR,
  type LinkPush,
} from "./link.constants.ts";

type LinkKeys = {
  paths: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
  push: z.ZodDefault<z.ZodEnum<{ [K in LinkPush]: K }>>;
};

/**
 * The schema of `link`: `paths` maps a package name to a path relative to the repo root; `push` is block or allow.
 * Each key it omits, and the section itself, parse to the default: no paths, and a push check that blocks.
 */
export function linkSchema(): z.ZodDefault<z.ZodObject<LinkKeys, z.core.$strict>> {
  return z
    .strictObject(
      {
        paths: z.record(z.string(), z.string({ error: LINK_PATH_ERROR }), { error: LINK_PATHS_ERROR }).default({}),
        push: z.enum(LINK_PUSH, { error: LINK_PUSH_ERROR }).default(DEFAULT_LINK_PUSH),
      },
      { error: LINK_OBJECT_ERROR },
    )
    .default({ paths: {}, push: DEFAULT_LINK_PUSH });
}
