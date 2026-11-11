/** `a` quoted for a Windows shell when it holds a space or a shell character, else as it is. */
export function quoteWin(a: string) {
  return /[\s"&|<>^]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a;
}
