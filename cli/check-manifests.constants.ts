/** A quoted span in a script; a separator inside one is an argument, not the end of a call. */
export const QUOTED_SPAN: RegExp = /'[^']*'|"[^"]*"/g;

/** The separators that end one tool call and start the next in a script. */
export const CALL_SEPARATOR: RegExp = /&&|;/;
