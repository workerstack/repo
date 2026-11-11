const INTENT_PREFIXES = [
  "can you please",
  "could you please",
  "would you please",
  "can you",
  "could you",
  "would you",
  "please",
  "i want you to",
  "i need you to",
  "i would like you to",
  "i'd like you to",
];
const INTENT_MID: [string, string][] = [
  [String.raw`\bmake me an\b`, "make"],
  [String.raw`\bmake me a\b`, "make"],
  [String.raw`\bmake me\b`, "make"],
  [String.raw`\bi want the\b`, ""],
  [String.raw`\bi need the\b`, ""],
  [String.raw`\bi want a\b`, ""],
  [String.raw`\bi need a\b`, ""],
  [String.raw`\bi want\b`, ""],
  [String.raw`\bi need\b`, ""],
  [String.raw`\bto\s*,`, ","],
];
const FILLER_PREFIX = new RegExp(`^(?:${INTENT_PREFIXES.join("|")})\\s+`, "i");
const FILLER_SUFFIX = /\s+(?:thank you|thanks|please)[.!]*\s*$/i;
const COMMA_WS = /\s*,\s*/g;
const WS_RUN = /[ \t]+/g;

function normalizeNewlines(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/** One line with the intent filler cut: polite prefixes, trailing thanks, and "make me a" style phrases. */
export function stripFiller(text: string): string {
  let prev: string | null = null;
  while (prev !== text) {
    prev = text;
    text = text.replace(FILLER_PREFIX, "").trim();
    text = text.replace(FILLER_SUFFIX, "").trim();
    for (const [pat, repl] of INTENT_MID) text = text.replaceAll(new RegExp(pat, "gi"), repl);

    text = text.replaceAll(COMMA_WS, " ");
    text = text.replaceAll(WS_RUN, " ").trim();
  }
  return text;
}

/** Joins the non-empty lines of `raw` into one line and strips intent filler from it. */
export function scrubText(raw: string): string {
  const lines = normalizeNewlines(raw)
    .split("\n")
    .map((ln) => ln.trim())
    .filter(Boolean);
  return stripFiller(lines.join(" ").replaceAll(WS_RUN, " ").trim());
}
