import { MAJOR_SEPARATOR, PLAIN, PREFIX, PROTOCOL, TAG, WILDCARD } from "./update.constants.ts";

/**
 * How `repo update` reads a spec: a plain version it checks, a range it lists, or a protocol or tag it leaves
 * alone.
 */
export type Parsed = { kind: "plain"; prefix: string; version: string } | { kind: "range" } | { kind: "silent" };

/** Sorts a dependency spec into plain, range or silent. */
export function parseSpec(spec: string): Parsed {
  if (PLAIN.test(spec)) {
    const version = spec.replace(PREFIX, "");

    return { kind: "plain", prefix: spec.slice(0, spec.length - version.length), version };
  }

  if (PROTOCOL.test(spec) || (TAG.test(spec) && !WILDCARD.test(spec))) return { kind: "silent" };

  return { kind: "range" };
}

/** True when `version` sorts before `latest`; a prerelease above `latest` is not behind. */
export function isBehind(version: string, latest: string): boolean {
  return Bun.semver.order(version, latest) < 0;
}

/** True when `latest` is a higher major than `version`. */
export function isMajor(version: string, latest: string): boolean {
  return Number(latest.split(MAJOR_SEPARATOR)[0]) > Number(version.split(MAJOR_SEPARATOR)[0]);
}
