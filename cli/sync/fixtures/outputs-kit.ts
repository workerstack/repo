// Planned outputs for the sync suites: a whole file and a link, tracked, as a generator plans them.
import type { Output } from "../outputs.ts";

/** A whole tracked file output at `rel`; its content defaults to its own path and a newline. */
export function file(rel: string, content = `${rel}\n`): Output {
  return { content, kind: "file", managed: "whole", path: rel, tracked: true };
}

/** A whole tracked link output at `rel` pointing at `target`. */
export function link(rel: string, target: string): Output {
  return { kind: "link", managed: "whole", path: rel, target, tracked: true };
}
