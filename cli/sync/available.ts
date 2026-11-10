import { group } from "../docs-fences.ts";
import { SECOND_GROUP, THIRD_GROUP } from "../docs-fences.constants.ts";
import { lines } from "../scripts/managed-text.ts";
import { AVAILABLE_INDEX_PATH, ENTRY, SECTION_CLOSE, SECTION_OPEN } from "./available.constants.ts";

type Entry = { name: string; url: string; description: string };

/** The `- [name](url): description` lines of the published index, outside any `repo:*` section. */
function parseEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  let inSection = false;
  for (const line of lines(text)) {
    if (SECTION_OPEN.test(line)) inSection = true;
    else if (SECTION_CLOSE.test(line)) inSection = false;
    else if (!inSection) {
      const match = ENTRY.exec(line);
      if (match)
        entries.push({
          name: group(match, 1),
          url: group(match, SECOND_GROUP),
          description: group(match, THIRD_GROUP),
        });
    }
  }
  return entries;
}

/**
 * The repo:available body: one line per package of the installed `@workerstack/references` index that is not in
 * `installed`, in index order. Null when the index is not installed.
 */
export function available(read: (rel: string) => string | null, installed: ReadonlySet<string>): string | null {
  const text = read(AVAILABLE_INDEX_PATH);
  if (text === null) return null;
  return parseEntries(text)
    .filter(({ name }) => !installed.has(name))
    .map(({ name, url, description }) => `- [${name}](${url}): ${description}`)
    .join("\n");
}
