/** `text` split on LF or CRLF, every line kept, a last empty one included. */
export function lines(text: string): string[] {
  return text.split(/\r?\n/);
}
