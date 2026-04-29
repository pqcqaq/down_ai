const protectedTokenPattern =
  /\\(?:cite|citep|citet|parencite|textcite|ref|autoref|cref|Cref|eqref|pageref|label|url|href|includegraphics|input|include|gls|Gls|acrshort|acrlong|acrfull)\*?(?:\[[^\]]*])*\{[^{}]*\}/g;

export type RevisionValidation = {
  protectedTokenOk: boolean;
  lengthDeltaRatio: number;
  warnings: string[];
};

export function validateRevisionText(originalText: string, revisedText: string): RevisionValidation {
  const originalTokens = originalText.match(protectedTokenPattern) ?? [];
  const revisedTokens = revisedText.match(protectedTokenPattern) ?? [];
  const protectedTokenOk = sorted(originalTokens).join("\n") === sorted(revisedTokens).join("\n");
  const lengthDeltaRatio = originalText.length === 0 ? 0 : (revisedText.length - originalText.length) / originalText.length;
  const warnings: string[] = [];

  if (!protectedTokenOk) {
    warnings.push("protected-token-drift");
  }
  if (Math.abs(lengthDeltaRatio) > 0.6) {
    warnings.push("large-length-delta");
  }
  if (/```/.test(revisedText)) {
    warnings.push("markdown-fence-detected");
  }

  return {
    protectedTokenOk,
    lengthDeltaRatio,
    warnings,
  };
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}
