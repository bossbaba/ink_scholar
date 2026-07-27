import { create } from "zustand";
import type { Chapter } from "@/types";
import { useNovelStore } from "./useNovelStore";

interface ChapterState {
  loading: boolean;
  error: string | null;

  loadAll: (projectId: string) => Promise<void>;
  create: (projectId: string, title: string) => Promise<Chapter | undefined>;
  openDetail: (id: string) => Promise<void>;
  saveContent: (id: string, content: string) => Promise<void>;
  updateMeta: (id: string, newTitle: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  select: (id: string | null) => void;
  clear: () => void;
}

/**
 * Chapter store — delegates to novelStore for actual chapter data,
 * provides a simplified interface for chapter-list views.
 */
export const useChapterStore = create<ChapterState>((set) => ({
  loading: false,
  error: null,

  loadAll: async (_projectId) => {
    set({ loading: true, error: null });
    try {
      // Chapters live inside currentNovel in novelStore
      const novel = useNovelStore.getState().currentNovel;
      if (novel) {
        await useNovelStore.getState().openNovel(novel.id);
      }
      set({ loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  create: async (projectId, title) => {
    const novelStore = useNovelStore.getState();
    // Ensure we're operating on the correct novel
    if (!novelStore.currentNovel || novelStore.currentNovel.id !== projectId) {
      await novelStore.openNovel(projectId);
    }
    return novelStore.addChapter(title);
  },

  openDetail: async (_id) => {
    // Chapter content loading is handled by novelStore.loadChapterContent
    const novelStore = useNovelStore.getState();
    await novelStore.loadChapterContent(_id);
  },

  saveContent: async (id, content) => {
    useNovelStore.getState().updateChapterContent(id, content);
  },

  updateMeta: async (id, newTitle) => {
    await useNovelStore.getState().renameChapter(id, newTitle);
  },

  remove: async (id) => {
    await useNovelStore.getState().deleteChapter(id);
  },

  select: (id) => {
    useNovelStore.getState().setActiveChapter(id);
  },

  clear: () => {
    useNovelStore.getState().setActiveChapter(null);
  },
}));
