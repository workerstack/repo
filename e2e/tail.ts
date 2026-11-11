/** The last `lines` lines of `text`. */
export function tail(text: string, lines = 80) {
  return text.split("\n").slice(-lines).join("\n");
}
