import { create } from "zustand";

interface SettingsState {
  theme: "light" | "dark";
  language: string;
  autoSaveInterval: number;
  editorFontSize: number;
  editorFontFamily: string;
  aiTemperature: number;
  aiMaxTokens: number;

  loadSettings: () => void;
  saveSettings: () => void;
  setTheme: (theme: "light" | "dark") => void;
  setLanguage: (language: string) => void;
  setAutoSaveInterval: (interval: number) => void;
  setEditorFontSize: (size: number) => void;
  setEditorFontFamily: (family: string) => void;
  setAiTemperature: (value: number) => void;
  setAiMaxTokens: (value: number) => void;
}

function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", theme === "dark");
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "light",
  language: "zh-CN",
  autoSaveInterval: 30000,
  editorFontSize: 16,
  editorFontFamily: "serif",
  aiTemperature: 0.7,
  aiMaxTokens: 2048,

  loadSettings: () => {
    try {
      const saved = localStorage.getItem("app_settings");
      if (saved) {
        const settings = JSON.parse(saved);
        set({
          theme: settings.theme || "light",
          language: settings.language || "zh-CN",
          autoSaveInterval: settings.autoSaveInterval || 30000,
          editorFontSize: settings.editorFontSize || 16,
          editorFontFamily: settings.editorFontFamily || "serif",
          aiTemperature: typeof settings.aiTemperature === "number" ? settings.aiTemperature : 0.7,
          aiMaxTokens: typeof settings.aiMaxTokens === "number" ? settings.aiMaxTokens : 2048,
        });
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
    applyTheme(get().theme);
  },

  saveSettings: () => {
    const {
      theme,
      language,
      autoSaveInterval,
      editorFontSize,
      editorFontFamily,
      aiTemperature,
      aiMaxTokens,
    } = get();
    localStorage.setItem(
      "app_settings",
      JSON.stringify({
        theme,
        language,
        autoSaveInterval,
        editorFontSize,
        editorFontFamily,
        aiTemperature,
        aiMaxTokens,
      }),
    );
  },

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    get().saveSettings();
  },

  setLanguage: (language) => {
    set({ language });
    get().saveSettings();
  },

  setAutoSaveInterval: (autoSaveInterval) => {
    set({ autoSaveInterval });
    get().saveSettings();
  },

  setEditorFontSize: (editorFontSize) => {
    set({ editorFontSize });
    get().saveSettings();
  },

  setEditorFontFamily: (editorFontFamily) => {
    set({ editorFontFamily });
    get().saveSettings();
  },

  setAiTemperature: (aiTemperature) => {
    set({ aiTemperature });
    get().saveSettings();
  },

  setAiMaxTokens: (aiMaxTokens) => {
    set({ aiMaxTokens });
    get().saveSettings();
  },
}));
