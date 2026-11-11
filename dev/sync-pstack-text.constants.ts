/** The patterns the pstack adapters match against fetched skill text. */
export const LINE_SPLIT_RE: RegExp = /\r?\n/;
export const FM_FIELD_RE: RegExp = /^([^:#\s][^:]*):\s*(.*?)\s*$/;
export const SPACE_RUN_RE: RegExp = /\s+/g;
export const USE_FOR_RE: RegExp = /\bUse for /;
export const TRAILING_DOT_RE: RegExp = /\.$/;
export const TITLE_AND_FIRST_PARAGRAPH_RE: RegExp = /^(# .+\n(?:\n)?)([\s\S]*?)\n\n/;
export const TRAILING_SPACE_RE: RegExp = /\s+$/;
export const LEADING_NEWLINES_RE: RegExp = /^\n+/;
export const PRINCIPLE_LINK_RE: RegExp = /\[([^\]]+)\]\(\.\.\/(principle-[a-z0-9-]+)\/SKILL\.md\)/g;
export const PRINCIPLE_SKILL_RE: RegExp = /(?:[Tt]he )?\*\*([a-z0-9-]+)\*\* principle skill/g;

/** The patterns note pstack ships, which names two principle skills; the repo keeps only its first sentence. */
export const LANGUAGE_AGNOSTIC_NOTE: string =
  " The underlying principles are language-agnostic. See the **type-system-discipline** and " +
  "**boundary-discipline** principle skills.";
