export function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

export function splitTextBlocks(text: string): string[] {
  return text
    .split(/\n{2,}|(?<=。)\s*|(?<=\.)\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20);
}
