import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  Chapter,
  ChapterRevision,
  Character,
  CharacterRelation,
  NovelMetadata,
  NovelProject,
  WritingDailyStat,
} from "@/types";
import { StrUtils } from "@/utils";

// ===== Normalize helpers (snake_case -> camelCase) =====

function normalizeNovelMetadata(raw: unknown): NovelMetadata {
  const data = raw as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? ""),
    author: String(data.author ?? ""),
    genre: String(data.genre ?? ""),
    description: String(data.description ?? ""),
    coverPath: data.cover_path ? String(data.cover_path) : undefined,
    chapterCount: Number(data.chapter_count ?? data.chapterCount ?? 0),
    totalWordCount: Number(data.total_word_count ?? data.totalWordCount ?? 0),
    createdAt: String(data.created_at ?? data.createdAt ?? ""),
    updatedAt: String(data.updated_at ?? data.updatedAt ?? ""),
  };
}

function normalizeNovelProject(raw: unknown): NovelProject {
  const data = raw as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? ""),
    author: String(data.author ?? ""),
    genre: String(data.genre ?? ""),
    description: String(data.description ?? ""),
    coverPath: data.cover_path ? String(data.cover_path) : undefined,
    chapters: Array.isArray(data.chapters) ? data.chapters.map((c) => normalizeChapter(c)) : [],
    outline: data.outline ? String(data.outline) : undefined,
    createdAt: String(data.created_at ?? data.createdAt ?? ""),
    updatedAt: String(data.updated_at ?? data.updatedAt ?? ""),
  };
}

function normalizeChapter(raw: unknown): Chapter {
  const data = raw as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? ""),
    content: String(data.content ?? ""),
    contentLoaded: Boolean(data.content_loaded ?? data.contentLoaded ?? false),
    order: Number(data.order ?? 0),
    wordCount: Number(data.word_count ?? data.wordCount ?? 0),
    createdAt: String(data.created_at ?? data.createdAt ?? ""),
    updatedAt: String(data.updated_at ?? data.updatedAt ?? ""),
  };
}

function normalizeCharacter(raw: unknown): Character {
  const data = raw as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    novelId: String(data.novel_id ?? data.novelId ?? ""),
    name: String(data.name ?? ""),
    identity: data.identity ? String(data.identity) : undefined,
    description: data.description ? String(data.description) : undefined,
    color: String(data.color ?? "#2FAEFF"),
    createdAt: String(data.created_at ?? data.createdAt ?? ""),
    updatedAt: String(data.updated_at ?? data.updatedAt ?? ""),
  };
}

function normalizeCharacterRelation(raw: unknown): CharacterRelation {
  const data = raw as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    novelId: String(data.novel_id ?? data.novelId ?? ""),
    fromId: String(data.from_id ?? data.fromId ?? ""),
    toId: String(data.to_id ?? data.toId ?? ""),
    category: String(data.category ?? "other"),
    label: data.label ? String(data.label) : undefined,
    description: data.description ? String(data.description) : undefined,
    createdAt: String(data.created_at ?? data.createdAt ?? ""),
  };
}

// ===== Store interface =====

interface NovelState {
  currentNovel: NovelProject | null;
  novels: NovelMetadata[];
  isLoading: boolean;
  isDirty: boolean;
  activeChapterId: string | null;

  // Computed-like getters
  getCurrentChapter: () => Chapter | null;

  // Actions
  fetchNovels: () => Promise<void>;
  createNovel: (
    title: string,
    author: string,
    genre: string,
    description: string,
  ) => Promise<NovelProject>;
  openNovel: (novelId: string) => Promise<void>;
  saveNovel: () => Promise<void>;
  deleteNovel: (novelId: string) => Promise<void>;
  addChapter: (title: string) => Promise<Chapter | undefined>;
  deleteChapter: (chapterId: string) => Promise<void>;
  renameChapter: (chapterId: string, newTitle: string) => Promise<void>;
  updateChapterContent: (chapterId: string, content: string) => void;
  loadChapterContent: (chapterId: string) => Promise<void>;
  setActiveChapter: (chapterId: string | null) => void;
  updateNovelMetadata: (metadata: Partial<NovelProject>) => void;

  // Chapter revisions
  listChapterRevisions: (chapterId: string) => Promise<ChapterRevision[]>;
  getChapterRevision: (revisionId: string, novelId: string) => Promise<ChapterRevision>;
  restoreChapterRevision: (chapterId: string, revisionId: string) => Promise<Chapter>;

  // Writing stats
  getWritingStats: (novelId?: string) => Promise<WritingDailyStat[]>;

  // Characters
  listCharacters: (novelId: string) => Promise<Character[]>;
  createCharacter: (
    novelId: string,
    name: string,
    identity: string | null,
    description: string | null,
    color: string | null,
  ) => Promise<Character>;
  updateCharacter: (
    id: string,
    name: string | null,
    identity: string | null,
    description: string | null,
    color: string | null,
  ) => Promise<void>;
  deleteCharacter: (novelId: string, id: string) => Promise<void>;
  listCharacterRelations: (novelId: string) => Promise<CharacterRelation[]>;
  upsertCharacterRelation: (
    novelId: string,
    fromId: string,
    toId: string,
    category: string,
    label: string | null,
    description: string | null,
  ) => Promise<CharacterRelation>;
  deleteCharacterRelation: (novelId: string, id: string) => Promise<void>;
}

// Word count debounce state (module-level, not in Zustand state)
let wordCountTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWordCount: { id: string; content: string } | null = null;

function flushWordCount(state: NovelState): NovelProject | null {
  if (wordCountTimer !== null) {
    clearTimeout(wordCountTimer);
    wordCountTimer = null;
  }
  let novel = state.currentNovel;
  if (pendingWordCount && novel) {
    const targetId = pendingWordCount.id;
    const wordCount = StrUtils.countWords(pendingWordCount.content);
    const updatedChapters = novel.chapters.map((c) =>
      c.id === targetId ? { ...c, wordCount } : c,
    );
    novel = { ...novel, chapters: updatedChapters };
    pendingWordCount = null;
  }
  return novel;
}

export const useNovelStore = create<NovelState>((set, get) => ({
  currentNovel: null,
  novels: [],
  isLoading: false,
  isDirty: false,
  activeChapterId: null,

  getCurrentChapter: () => {
    const { currentNovel, activeChapterId } = get();
    if (!currentNovel || currentNovel.chapters.length === 0) return null;
    if (activeChapterId) {
      const matched = currentNovel.chapters.find((c) => c.id === activeChapterId);
      if (matched) return matched;
    }
    return currentNovel.chapters[0];
  },

  fetchNovels: async () => {
    set({ isLoading: true });
    try {
      const raw = await invoke<NovelMetadata[]>("list_novels");
      set({ novels: Array.isArray(raw) ? raw.map(normalizeNovelMetadata) : [] });
    } catch (error) {
      console.error("Failed to fetch novels:", error);
      set({ novels: [] });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  createNovel: async (title, author, genre, description) => {
    set({ isLoading: true });
    try {
      const raw = await invoke<NovelProject>("create_novel", { title, author, genre, description });
      const novel = normalizeNovelProject(raw);
      await get().fetchNovels();
      return novel;
    } catch (error) {
      console.error("Failed to create novel:", error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  openNovel: async (novelId) => {
    set({ isLoading: true });
    try {
      const raw = await invoke<NovelProject>("open_novel", { novelId });
      set({ currentNovel: normalizeNovelProject(raw), isDirty: false });
    } catch (error) {
      console.error("Failed to open novel:", error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  saveNovel: async () => {
    const state = get();
    const currentNovel = flushWordCount(state);
    if (!currentNovel) return;
    set({ currentNovel });
    set({ isLoading: true });
    try {
      await invoke("save_novel", { novel: currentNovel });
      set({ isDirty: false });
    } catch (error) {
      console.error("Failed to save novel:", error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteNovel: async (novelId) => {
    set({ isLoading: true });
    try {
      await invoke("delete_novel", { novelId });
      const state = get();
      if (state.currentNovel?.id === novelId) {
        set({ currentNovel: null });
      }
      await get().fetchNovels();
    } catch (error) {
      console.error("Failed to delete novel:", error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  addChapter: async (title) => {
    const { currentNovel } = get();
    if (!currentNovel) return;
    set({ isLoading: true });
    try {
      const chapter = await invoke<Chapter>("add_chapter", { novelId: currentNovel.id, title });
      set({ currentNovel: { ...currentNovel, chapters: [...currentNovel.chapters, chapter] } });
      return chapter;
    } catch (error) {
      console.error("Failed to add chapter:", error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteChapter: async (chapterId) => {
    const { currentNovel } = get();
    if (!currentNovel) return;
    set({ isLoading: true });
    try {
      await invoke("delete_chapter", { novelId: currentNovel.id, chapterId });
      set({
        currentNovel: {
          ...currentNovel,
          chapters: currentNovel.chapters.filter((c) => c.id !== chapterId),
        },
      });
    } catch (error) {
      console.error("Failed to delete chapter:", error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  renameChapter: async (chapterId, newTitle) => {
    const { currentNovel } = get();
    if (!currentNovel) return;
    set({ isLoading: true });
    try {
      await invoke("rename_chapter", { novelId: currentNovel.id, chapterId, newTitle });
      const updatedChapters = currentNovel.chapters.map((c) =>
        c.id === chapterId ? { ...c, title: newTitle } : c,
      );
      set({ currentNovel: { ...currentNovel, chapters: updatedChapters } });
    } catch (error) {
      console.error("Failed to rename chapter:", error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  updateChapterContent: (chapterId, content) => {
    const { currentNovel } = get();
    if (!currentNovel) return;
    const chapter = currentNovel.chapters.find((c) => c.id === chapterId);
    if (chapter) {
      pendingWordCount = { id: chapterId, content };
      if (wordCountTimer !== null) clearTimeout(wordCountTimer);
      wordCountTimer = setTimeout(() => {
        const s = get();
        const updated = flushWordCount(s);
        if (updated) set({ currentNovel: updated });
      }, 300);
      set({
        isDirty: true,
        currentNovel: {
          ...currentNovel,
          chapters: currentNovel.chapters.map((c) =>
            c.id === chapterId ? { ...c, content, contentLoaded: true } : c,
          ),
        },
      });
    }
  },

  loadChapterContent: async (chapterId) => {
    const { currentNovel } = get();
    if (!currentNovel) return;
    const chapter = currentNovel.chapters.find((c) => c.id === chapterId);
    if (!chapter || chapter.contentLoaded) return;
    try {
      const content = await invoke<string>("load_chapter_content", {
        novelId: currentNovel.id,
        chapterId,
      });
      set({
        currentNovel: {
          ...currentNovel,
          chapters: currentNovel.chapters.map((c) =>
            c.id === chapterId ? { ...c, content, contentLoaded: true } : c,
          ),
        },
      });
    } catch (error) {
      console.error("Failed to load chapter content:", error);
    }
  },

  setActiveChapter: (chapterId) => set({ activeChapterId: chapterId }),

  updateNovelMetadata: (metadata) => {
    const { currentNovel } = get();
    if (!currentNovel) return;
    set({ isDirty: true, currentNovel: { ...currentNovel, ...metadata } });
  },

  // ===== Chapter Revisions =====
  listChapterRevisions: async (chapterId) => {
    const { currentNovel } = get();
    if (!currentNovel) return [];
    return await invoke<ChapterRevision[]>("list_chapter_revisions", {
      novelId: currentNovel.id,
      chapterId,
    });
  },

  getChapterRevision: async (revisionId, novelId) => {
    return await invoke<ChapterRevision>("get_chapter_revision", {
      novelId,
      revisionId,
    });
  },

  restoreChapterRevision: async (chapterId, revisionId) => {
    const { currentNovel } = get();
    if (!currentNovel) throw new Error("未打开小说");
    const chapter = await invoke<Chapter>("restore_chapter_revision", {
      novelId: currentNovel.id,
      chapterId,
      revisionId,
    });
    const idx = currentNovel.chapters.findIndex((c) => c.id === chapterId);
    if (idx >= 0) {
      set({
        currentNovel: {
          ...currentNovel,
          chapters: currentNovel.chapters.map((c) => (c.id === chapterId ? chapter : c)),
        },
      });
    }
    return chapter;
  },

  // ===== Writing Stats =====
  getWritingStats: async (novelId) => {
    return await invoke<WritingDailyStat[]>("get_writing_stats", {
      novelId: novelId ?? null,
    });
  },

  // ===== Characters =====
  listCharacters: async (novelId) => {
    const raw = await invoke<unknown[]>("list_characters", { novelId });
    return Array.isArray(raw) ? raw.map(normalizeCharacter) : [];
  },

  createCharacter: async (novelId, name, identity, description, color) => {
    const raw = await invoke<unknown>("create_character", {
      novelId,
      name,
      identity: identity ?? null,
      description: description ?? null,
      color: color ?? null,
    });
    return normalizeCharacter(raw);
  },

  updateCharacter: async (id, name, identity, description, color) => {
    await invoke("update_character", {
      id,
      name: name ?? null,
      identity: identity ?? null,
      description: description ?? null,
      color: color ?? null,
    });
  },

  deleteCharacter: async (novelId, id) => {
    await invoke("delete_character", { novelId, id });
  },

  listCharacterRelations: async (novelId) => {
    const raw = await invoke<unknown[]>("list_character_relations", { novelId });
    return Array.isArray(raw) ? raw.map(normalizeCharacterRelation) : [];
  },

  upsertCharacterRelation: async (novelId, fromId, toId, category, label, description) => {
    const raw = await invoke<unknown>("upsert_character_relation", {
      novelId,
      fromId,
      toId,
      category,
      label: label ?? null,
      description: description ?? null,
    });
    return normalizeCharacterRelation(raw);
  },

  deleteCharacterRelation: async (novelId, id) => {
    await invoke("delete_character_relation", { novelId, id });
  },
}));
