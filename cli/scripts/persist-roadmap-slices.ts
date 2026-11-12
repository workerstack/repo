/** Reads the slices out of a roadmap's Order section, in the legacy and the pointer shape. */
import {
  GOAL_KEY,
  KEY_RE,
  LOCATION_LINE_RE,
  POINTER_SLICE_RE,
  POINTER_TEXT_RE,
  SENTENCE_SPLIT_RE,
  SLICE_RE,
  TITLE_WORDS_MAX,
  TITLE_WORDS_MIN,
  WHY_KEY,
  WORD_SPLIT_RE,
} from "./persist-roadmap.constants.ts";

/** One `Title:` slice of the Order section. */
export type Slice = {
  title: string;
  goal: string;
  why: string;
  location: string;
  hasGoal: boolean;
  hasWhy: boolean;
  hasLocation: boolean;
};

/** One line of a pointer roadmap's Order: `N [ ] {title}: {one sentence}`, then an optional Location. */
export type PointerSlice = {
  n: string;
  ok: boolean;
  location: string | null;
};

export function sentences(text: unknown): string[] {
  return String(text)
    .trim()
    .split(SENTENCE_SPLIT_RE)
    .filter((s) => s.trim() !== "");
}

/** The words of a title. */
export function wordsOf(title: string): string[] {
  return title.split(WORD_SPLIT_RE).filter(Boolean);
}

function emptySlice(title: string): Slice {
  return { goal: "", hasGoal: false, hasLocation: false, hasWhy: false, location: "", title, why: "" };
}

function setKey(slice: Slice, name: string, value: string): void {
  if (name === GOAL_KEY) Object.assign(slice, { goal: value, hasGoal: true });
  else if (name === WHY_KEY) Object.assign(slice, { hasWhy: true, why: value });
  else Object.assign(slice, { hasLocation: true, location: value });
}

export function parseSlices(orderBody: unknown): Slice[] {
  const slices: Slice[] = [];

  for (const line of String(orderBody).split("\n")) {
    const head = line.match(SLICE_RE);

    if (head !== null) {
      slices.push(emptySlice(String(head.groups?.title).trim()));
      continue;
    }

    const key = line.match(KEY_RE);
    const cur = slices[slices.length - 1];

    if (cur !== undefined && key !== null) setKey(cur, String(key.groups?.key), String(key.groups?.value).trim());
  }

  return slices;
}

function pointerHead(head: RegExpMatchArray): PointerSlice {
  const text = String(head.groups?.text).trim().match(POINTER_TEXT_RE);
  const words = text === null ? 0 : wordsOf(String(text.groups?.title)).length;

  const ok =
    text !== null &&
    words >= TITLE_WORDS_MIN &&
    words <= TITLE_WORDS_MAX &&
    sentences(text.groups?.sentence).length === 1;

  return { location: null, n: String(head.groups?.n), ok };
}

export function parsePointerSlices(orderBody: string): PointerSlice[] {
  const slices: PointerSlice[] = [];

  for (const line of orderBody.split("\n")) {
    const head = line.match(POINTER_SLICE_RE);

    if (head !== null) {
      slices.push(pointerHead(head));
      continue;
    }

    const cur = slices[slices.length - 1];

    if (cur === undefined || line.trim() === "") continue;
    const loc = line.match(LOCATION_LINE_RE);

    // A slice is one line; only a Location line may follow it.
    if (loc !== null && cur.location === null) cur.location = String(loc[1]).trim();
    else cur.ok = false;
  }

  return slices;
}
