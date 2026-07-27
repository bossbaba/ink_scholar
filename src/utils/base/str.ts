export function strIsEmpty(s: string | undefined | null): s is null | undefined {
  return s === undefined || s === null || s === "";
}

/**
 * 统计文本字数（Unicode 字形簇计数）。
 * 使用 Intl.Segmenter 精确计算，含 emoji/生僻字/组合字符；
 * 回退到 .length（UTF-16 码元数）。
 * 与后端 rusqlite 的 chars().count() 行为一致。
 */
export function countWords(text: string): number {
  if (!text) return 0;
  try {
    const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
    return [...segmenter.segment(text.replace(/\s/gu, ""))].length;
  } catch {
    return text.replace(/\s/gu, "").length;
  }
}
