/** Each mid-text intent phrase and what it becomes; a `g` regex used only with replaceAll. */
const INTENT_MID: readonly (readonly [RegExp, string])[] = [
  [/\bmake me an\b/gi, "make"],
  [/\bmake me a\b/gi, "make"],
  [/\bmake me\b/gi, "make"],
  [/\bi want the\b/gi, ""],
  [/\bi need the\b/gi, ""],
  [/\bi want a\b/gi, ""],
  [/\bi need a\b/gi, ""],
  [/\bi want\b/gi, ""],
  [/\bi need\b/gi, ""],
  [/\bto\s*,/gi, ","],
];

/** The polite openers cut from a prompt's start, longest first where one is a prefix of another. */
const ASK_OPENERS = "can you please|could you please|would you please|can you|could you|would you|please";
const WANT_OPENERS = "i want you to|i need you to|i would like you to|i'd like you to";
const FILLER_PREFIX: Readonly<RegExp> = /* @__PURE__ */ new RegExp(`^(?:${ASK_OPENERS}|${WANT_OPENERS})\\s+`, "i");
const FILLER_SUFFIX = /\s+(?:thank you|thanks|please)[.!]*\s*$/i;
const COMMA_WS = /\s*,\s*/g;
const WS_RUN = /[ \t]+/g;

function normalizeNewlines(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/** One pass of the filler cut. */
function stripOnce(text: string): string {
  let s = text.replace(FILLER_PREFIX, "").trim();
  s = s.replace(FILLER_SUFFIX, "").trim();

  for (const [re, repl] of INTENT_MID) s = s.replaceAll(re, repl);
  s = s.replaceAll(COMMA_WS, " ");

  return s.replaceAll(WS_RUN, " ").trim();
}

/** One line with the intent filler cut: polite prefixes, trailing thanks, and "make me a" style phrases. */
export function stripFiller(text: string): string {
  let prev: string | null = null;
  let cur = text;

  while (prev !== cur) {
    prev = cur;
    cur = stripOnce(cur);
  }

  return cur;
}

/** Joins the non-empty lines of `raw` into one line and strips intent filler from it. */
export function scrubText(raw: string): string {
  const lines = normalizeNewlines(raw)
    .split("\n")
    .map((ln) => ln.trim())
    .filter(Boolean);

  return stripFiller(lines.join(" ").replaceAll(WS_RUN, " ").trim());
}
