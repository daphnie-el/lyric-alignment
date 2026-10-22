// Keep character offsets so splitting does not normalize punctuation or spacing.
export function lyricWords(text: string) {
  return Array.from(text.matchAll(/\S+/gu), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function splitLyricText(text: string, afterWord: number) {
  const words = lyricWords(text);
  if (
    words.length < 3 || !Number.isInteger(afterWord) ||
    afterWord < 1 || afterWord >= words.length
  ) return undefined;
  return [
    text.slice(0, words[afterWord - 1].end),
    text.slice(words[afterWord].start),
  ] as const;
}

export function parseSplitTime(text: string): number | undefined {
  const match = /^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match) return undefined;
  const value = Number(match[1]) * 60000 + Number(match[2]) * 1000 +
    Number((match[3] ?? "").padEnd(3, "0"));
  return Number.isSafeInteger(value) ? value : undefined;
}
