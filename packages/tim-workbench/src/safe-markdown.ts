export type SafeInlineToken = Readonly<{
  kind: 'text' | 'strong';
  value: string;
}>;

/** Parse the small Markdown subset used by chat replies without producing HTML. */
export function parseSafeInlineMarkdown(source: string): readonly SafeInlineToken[] {
  const tokens: SafeInlineToken[] = [];
  let strong = false;
  let buffer = '';
  const flush = (): void => {
    if (!buffer) return;
    tokens.push({ kind: strong ? 'strong' : 'text', value: buffer });
    buffer = '';
  };
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '*' && source[index + 1] === '*') {
      flush();
      strong = !strong;
      index += 1;
      continue;
    }
    buffer += source[index];
  }
  flush();
  return tokens;
}
