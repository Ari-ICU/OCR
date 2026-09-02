/**
 * Khmer Unicode & OCR Anomaly Detection Utility.
 * Evaluates text line-by-line to identify broken character sequences,
 * lost consonants, coeng (ជើង) sequencing errors, misplaced vowels,
 * illegal diacritic stacking, and OCR artifacts.
 */

export interface KhmerIssue {
  start: number;
  end: number;
  line: number;
  column: number;
  text: string;
  type:
    | "broken_coeng"
    | "misplaced_vowel"
    | "ocr_artifact"
    | "unmatched_latex"
    | "duplicate_diacritic"
    | "out_of_order"
    | "orphan_sign";
  message: string;
}

// Khmer Unicode ranges:
// Consonants: ក-អ (\u1780-\u17A2), Independent vowels: ឣ-ឳ (\u17A3-\u17B3)
export const KHMER_CONSONANTS = "[\u1780-\u17B3]";
export const KHMER_COENG = "\u17D2"; // ្ (Coeng subscript prefix)
// Dependent Vowels: ា, ិ, ី, ឹ, ឺ, ុ, ូ, ួ, ើ, ឿ, ៀ, េ, ែ, ៃ, ោ, ៅ (\u17B6-\u17C5)
export const KHMER_DEPENDENT_VOWELS = "[\u17B6-\u17C5]";
// Upper & Lower Diacritics/Signs: ំ, ះ, ៈ, ៉, ៊, ់, ៌, ៍, ៎, ៏, ័, ៑, ៝ (\u17C6-\u17D1\u17D3\u17DD)
export const KHMER_DIACRITICS = "[\u17C6-\u17D1\u17D3\u17DD]";

/**
 * Checks a string line-by-line for Khmer Unicode ordering corruptions and OCR anomalies.
 */
export function detectKhmerErrors(text: string): KhmerIssue[] {
  if (!text) return [];

  const rawIssues: KhmerIssue[] = [];
  const lines = text.split("\n");
  let globalOffset = 0;

  lines.forEach((lineText, lineIdx) => {
    const lineNum = lineIdx + 1;

    // Helper to push issue with exact line and column
    const addIssue = (
      startInLine: number,
      endInLine: number,
      matchText: string,
      type: KhmerIssue["type"],
      message: string
    ) => {
      rawIssues.push({
        start: globalOffset + startInLine,
        end: globalOffset + endInLine,
        line: lineNum,
        column: startInLine + 1,
        text: matchText,
        type,
        message: `[Line ${lineNum}, Col ${startInLine + 1}]: ${message}`,
      });
    };

    // 1. Isolated / Dangling Coeng (ជើង without following consonant, e.g. "អ្ ", "ស្\n", "្ា", "្1")
    const danglingCoengRegex = new RegExp(`${KHMER_COENG}(?![\\u1780-\\u17B3])`, "g");
    let match: RegExpExecArray | null;
    while ((match = danglingCoengRegex.exec(lineText)) !== null) {
      addIssue(
        match.index,
        match.index + match[0].length,
        match[0],
        "broken_coeng",
        "Broken Coeng (ជើង): ្ is missing a subscript consonant."
      );
    }

    // 2. Misplaced Coeng at line or word start without preceding base consonant (e.g. "^្ក" or " ្ក")
    const leadingCoengRegex = new RegExp(`(^|\\s)${KHMER_COENG}[\\u1780-\\u17B3]`, "g");
    while ((match = leadingCoengRegex.exec(lineText)) !== null) {
      const matchStart = match.index + (match[1] ? match[1].length : 0);
      const matchedStr = match[0].trimStart();
      addIssue(
        matchStart,
        matchStart + matchedStr.length,
        matchedStr,
        "broken_coeng",
        "Misplaced Coeng (ជើង): Subscript cannot appear without a base consonant."
      );
    }

    // 3. Consecutive Double Coengs without consonant in between (e.g. ្្)
    const doubleCoengRegex = /\u17D2\u17D2+/g;
    while ((match = doubleCoengRegex.exec(lineText)) !== null) {
      addIssue(
        match.index,
        match.index + match[0].length,
        match[0],
        "broken_coeng",
        "Duplicate Coeng (ជើង): Multiple ្ stacked consecutively."
      );
    }

    // 4. Misplaced Dependent Vowel at word start (e.g. " ា", "^ិ", " ោ")
    const leadingVowelRegex = new RegExp(`(^|\\s)${KHMER_DEPENDENT_VOWELS}+`, "g");
    while ((match = leadingVowelRegex.exec(lineText)) !== null) {
      const matchStart = match.index + (match[1] ? match[1].length : 0);
      const matchedStr = match[0].trimStart();
      addIssue(
        matchStart,
        matchStart + matchedStr.length,
        matchedStr,
        "misplaced_vowel",
        "Orphan Vowel: Dependent vowel without a base consonant."
      );
    }

    // 5. Out-of-Order: Dependent Vowel before Coeng (e.g. "កា្ដ" instead of "ក្ដា")
    const vowelBeforeCoengRegex = new RegExp(`(${KHMER_DEPENDENT_VOWELS}+)(${KHMER_COENG}[\\u1780-\\u17B3])`, "g");
    while ((match = vowelBeforeCoengRegex.exec(lineText)) !== null) {
      addIssue(
        match.index,
        match.index + match[0].length,
        match[0],
        "out_of_order",
        "Khmer Unicode Order Error: Dependent vowel placed before subscript (Coeng). Correct order: Base + Coeng + Vowel."
      );
    }

    // 6. Orphan Diacritics/Signs without base consonant (e.g. " ់", "^ះ", " ័", " ៍")
    const orphanSignRegex = new RegExp(`(^|\\s)${KHMER_DIACRITICS}+`, "g");
    while ((match = orphanSignRegex.exec(lineText)) !== null) {
      const matchStart = match.index + (match[1] ? match[1].length : 0);
      const matchedStr = match[0].trimStart();
      addIssue(
        matchStart,
        matchStart + matchedStr.length,
        matchedStr,
        "orphan_sign",
        "Orphan Diacritic Sign: Diacritic sign has no base consonant."
      );
    }

    // 7. Duplicate / Conflicting Dependent Vowels on same consonant (e.g. ាា, ិី, ើា)
    const duplicateVowelsRegex = /[\u17B6-\u17C5]{2,}/g;
    while ((match = duplicateVowelsRegex.exec(lineText)) !== null) {
      // Valid Khmer compound vowels: ោះ (\u17C4\u17C7), េះ (\u17C1\u17C7), ុះ (\u17BB\u17C7), ិ៍ (\u17B7\u17CD)
      if (
        match[0] === "\u17C4\u17C7" ||
        match[0] === "\u17C1\u17C7" ||
        match[0] === "\u17C5\u17C6" ||
        match[0] === "\u17BB\u17C7"
      ) {
        continue;
      }
      addIssue(
        match.index,
        match.index + match[0].length,
        match[0],
        "duplicate_diacritic",
        "Conflicting Vowels: Multiple conflicting dependent vowels stacked on the same syllable."
      );
    }

    // 8. OCR Artifact: Latin characters scrambled inside Khmer words (e.g. "សេbក្ដី", "kñ", "អកxVរ")
    // Excluding hyphens (-) and valid punctuation
    const ocrArtifactRegex = /[\u1780-\u17D3]+[a-zA-Z0-9_~`]+[\u1780-\u17D3]+/g;
    while ((match = ocrArtifactRegex.exec(lineText)) !== null) {
      addIssue(
        match.index,
        match.index + match[0].length,
        match[0],
        "ocr_artifact",
        "OCR Scramble Artifact: Latin characters/numbers trapped inside Khmer word."
      );
    }

    // Advance global offset (+1 for newline character)
    globalOffset += lineText.length + 1;
  });

  // Filter overlapping issues and sort by character start index
  rawIssues.sort((a, b) => a.start - b.start);

  const cleanIssues: KhmerIssue[] = [];
  let lastEnd = -1;

  for (const issue of rawIssues) {
    if (issue.start >= lastEnd) {
      cleanIssues.push(issue);
      lastEnd = issue.end;
    }
  }

  return cleanIssues;
}
