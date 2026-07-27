import type { ChatMessage } from "@/types";

export const PROMPTS = {
  // 将作品背景（书名 / 类型 / 简介 / 大纲等）拼接到 system 消息末尾，
  // 让 AI 在续写、优化、灵感等场景下始终带着全局设定，避免人设与情节走偏。
  withNovelContext(systemContent: string, novelContext?: string): string {
    if (!novelContext) return systemContent;
    return `${systemContent}\n\n${novelContext}`;
  },

  buildOutline(
    genre: string,
    theme: string,
    chapterCount: number,
    novelContext?: string,
  ): ChatMessage[] {
    return [
      {
        role: "system",
        content: PROMPTS.withNovelContext(
          "你是一位资深小说策划专家，擅长构建引人入胜的故事大纲。",
          novelContext,
        ),
      },
      {
        role: "user",
        content: `请帮我构建一个${genre}类型的小说大纲。

主题：${theme}
章节数量：${chapterCount}

请按照以下格式输出：
1. 小说标题建议
2. 核心设定（世界观、背景）
3. 主要人物设定（主角、配角）
4. 章节大纲（每章的标题和主要内容概述）

请确保故事有清晰的起承转合，情节引人入胜。`,
      },
    ];
  },

  buildInspiration(context: string, style: string, novelContext?: string): ChatMessage[] {
    return [
      {
        role: "system",
        content: PROMPTS.withNovelContext(
          "你是一位创意灵感大师，能够提供丰富多样的写作灵感。",
          novelContext,
        ),
      },
      {
        role: "user",
        content: `我正在创作一部小说，需要一些灵感。

当前故事背景：${context}
写作风格：${style}

请提供以下方面的灵感：
1. 情节转折点建议（3个）
2. 角色发展建议（2个）
3. 场景描写灵感（2个）
4. 冲突与悬念设计（2个）

每个灵感请详细描述，并说明如何融入故事。`,
      },
    ];
  },

  continueWriting(previousText: string, direction?: string, novelContext?: string): ChatMessage[] {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: PROMPTS.withNovelContext(
          "你是一位优秀的小说作家，擅长续写故事。请保持原文的风格和语气，自然地延续故事。",
          novelContext,
        ),
      },
      {
        role: "user",
        content: `请基于以下内容续写：

${previousText}

${direction ? `续写方向：${direction}` : ""}

请续写约500字，保持故事的连贯性和吸引力。`,
      },
    ];
    return messages;
  },

  optimizeSentence(text: string, novelContext?: string): ChatMessage[] {
    return [
      {
        role: "system",
        content: PROMPTS.withNovelContext(
          "你是一位文学编辑专家，擅长优化句子表达。请提供优化后的句子，并解释修改原因。",
          novelContext,
        ),
      },
      {
        role: "user",
        content: `请优化以下句子：

${text}

请提供：
1. 优化后的句子（2-3个版本）
2. 每个版本的修改说明
3. 推荐的最佳版本及理由`,
      },
    ];
  },

  optimizeParagraph(text: string, novelContext?: string): ChatMessage[] {
    return [
      {
        role: "system",
        content: PROMPTS.withNovelContext(
          "你是一位文学编辑专家，擅长优化段落结构和表达。",
          novelContext,
        ),
      },
      {
        role: "user",
        content: `请优化以下段落：

${text}

请从以下方面优化：
1. 语言流畅度
2. 逻辑连贯性
3. 描写生动性
4. 节奏感

请提供优化后的段落，并说明主要修改点。`,
      },
    ];
  },

  optimizeWord(text: string, novelContext?: string): ChatMessage[] {
    return [
      {
        role: "system",
        content: PROMPTS.withNovelContext(
          "你是一位词汇专家，擅长提供精准、生动的词语选择。",
          novelContext,
        ),
      },
      {
        role: "user",
        content: `请优化以下文本中的用词：

${text}

请：
1. 标出可以优化的词语
2. 提供2-3个替换建议
3. 说明每个替换词的优缺点
4. 给出最终推荐`,
      },
    ];
  },

  fixGrammar(text: string, novelContext?: string): ChatMessage[] {
    return [
      {
        role: "system",
        content: PROMPTS.withNovelContext(
          "你是一位语法专家，擅长检查和修正中文语法错误。",
          novelContext,
        ),
      },
      {
        role: "user",
        content: `请检查并修正以下文本的语法错误：

${text}

请：
1. 标出所有语法错误
2. 提供修正后的文本
3. 解释每个错误的类型和修正原因`,
      },
    ];
  },
};
