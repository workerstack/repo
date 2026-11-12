/** What a spawned process wrote on a stream: the text, a buffer decoded as UTF-8, or "" when it wrote none. */
export function streamText(stream: string | Buffer | null | undefined): string {
  return stream?.toString() ?? "";
}
