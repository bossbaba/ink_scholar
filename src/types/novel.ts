export interface NovelProject {
  id: string;
  title: string;
  author: string;
  genre: string;
  description: string;
  coverPath?: string;
  chapters: Chapter[];
  outline?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
  /** 正文是否已从后端加载。懒加载下 open_novel 返回时该字段为 false，需调 loadChapterContent 后变 true。 */
  contentLoaded: boolean;
  order: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NovelMetadata {
  id: string;
  title: string;
  author: string;
  genre: string;
  description: string;
  coverPath?: string;
  chapterCount: number;
  totalWordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterRevision {
  id: string;
  chapterId: string;
  novelId: string;
  title: string;
  content: string;
  wordCount: number;
  revisionIndex: number;
  createdAt: string;
}

export interface WritingDailyStat {
  novelId: string;
  statDate: string;
  totalWords: number;
  chapterCount: number;
}

export interface Character {
  id: string;
  novelId: string;
  name: string;
  identity?: string;
  description?: string;
  /** 头像标签色（hex） */
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterRelation {
  id: string;
  novelId: string;
  fromId: string;
  toId: string;
  /** emotion / blood / mentor / enemy / other */
  category: string;
  label?: string;
  description?: string;
  createdAt: string;
}

/** 角色关系类别（固定 5 类，颜色用于描边/填充/圆点/竖条，不用于文字） */
export const RELATION_CATEGORIES: Record<string, { label: string; color: string }> = {
  emotion: { label: "情感", color: "#F26B9C" },
  blood: { label: "血缘", color: "#C9A96E" },
  mentor: { label: "师徒", color: "#5AC8D8" },
  enemy: { label: "敌对", color: "#F0544F" },
  other: { label: "其他", color: "#9AA3B2" },
};

/** 新建/编辑角色时可选的 10 色品牌色板（数据驱动，非样式字面量） */
export const CHARACTER_PALETTE: string[] = [
  "#2FAEFF",
  "#0C6FB4",
  "#5AC8D8",
  "#1FA971",
  "#E0A64E",
  "#D18F2E",
  "#F5708A",
  "#F0544F",
  "#C9A96E",
  "#36BFA3",
];
