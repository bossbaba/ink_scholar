import type { NovelProject } from "@/types";

/**
 * 将当前小说的基础背景（书名 / 类型 / 作者 / 简介 / 大纲）格式化为一段上下文文本，
 * 供各 AI 工具在调用模型时携带，使 AI 理解作品全局设定、保持续写与优化的一致性。
 *
 * - 没有打开小说时返回空字符串，调用方据此决定是否注入（不污染无关请求）。
 * - 大纲过长时做软截断，避免单次请求 prompt 膨胀失控。
 */
const OUTLINE_LIMIT = 6000;

export function buildNovelContext(novel: NovelProject | null): string {
  if (!novel) return "";

  const lines: string[] = [];
  lines.push(`书名：《${novel.title || "未命名作品"}》`);
  if (novel.genre) lines.push(`类型：${novel.genre}`);
  if (novel.author) lines.push(`作者：${novel.author}`);

  const description = novel.description?.trim();
  if (description) {
    lines.push(`简介：${description}`);
  }

  const outline = novel.outline?.trim();
  if (outline) {
    const shown =
      outline.length > OUTLINE_LIMIT
        ? `${outline.slice(0, OUTLINE_LIMIT)}\n…（大纲已截断）`
        : outline;
    lines.push(`大纲：\n${shown}`);
  } else {
    lines.push("大纲：（本书尚未设定大纲）");
  }

  return `【作品背景】\n${lines.join("\n")}`;
}
