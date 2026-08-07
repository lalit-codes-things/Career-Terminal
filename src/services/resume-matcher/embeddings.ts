function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+/#\s-]/g, ' ')
    .split(/[\s/,-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function jaccardScore(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * TokenOverlapMatcher — token-set Jaccard similarity.
 *
 * This is NOT a semantic embedding model. It computes lexical overlap
 * between tokenized term sets. It is useful for exact/near-expect term
 * matching but does not capture semantic meaning.
 */
export class TokenOverlapMatcher {
  public scoreSimilarity(textA: string, textB: string): number {
    const cleanA = textA.toLowerCase().trim();
    const cleanB = textB.toLowerCase().trim();

    if (!cleanA || !cleanB) return 0;
    if (cleanA === cleanB) return 1;
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return 0.85;

    const tokensA = new Set(tokenize(cleanA));
    const tokensB = new Set(tokenize(cleanB));
    const score = jaccardScore(tokensA, tokensB);

    return Number(score.toFixed(4));
  }
}
