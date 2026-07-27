import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type {
  AiProviderConfig,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StreamChunk,
} from "@/types";

const STORE_PATH = "ai-providers.json";
const MAX_HISTORY = 50;

let _store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await Store.load(STORE_PATH);
  }
  return _store;
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ===== Store interface =====

interface AiState {
  providers: AiProviderConfig[];
  activeProvider: AiProviderConfig | null;
  isStreaming: boolean;
  streamContent: string;
  chatHistory: ChatMessage[];

  loadProviders: () => Promise<void>;
  saveProviders: () => Promise<void>;
  addProvider: (config: AiProviderConfig) => Promise<void>;
  updateProvider: (index: number, config: AiProviderConfig) => Promise<void>;
  removeProvider: (index: number) => Promise<void>;
  setActiveProvider: (config: AiProviderConfig) => void;
  chat: (messages: ChatMessage[]) => Promise<ChatResponse>;
  chatStream: (
    messages: ChatMessage[],
    onChunk: (content: string) => void,
  ) => Promise<ChatResponse>;
  cancelStream: () => void;
  listModels: (provider: AiProviderConfig) => Promise<string[]>;
  testConnection: (provider: AiProviderConfig) => Promise<boolean>;
  addToHistory: (message: ChatMessage) => void;
  clearHistory: () => void;
}

// Module-level stream state (not in Zustand state to avoid re-renders)
let unlistenStream: (() => void) | null = null;
let currentSessionId: string | null = null;

export const useAiStore = create<AiState>((set, get) => ({
  providers: [],
  activeProvider: null,
  isStreaming: false,
  streamContent: "",
  chatHistory: [],

  loadProviders: async () => {
    try {
      const store = await getStore();
      const savedProviders = await store.get<AiProviderConfig[]>("ai_providers");
      if (savedProviders) {
        let migrated = false;
        for (const p of savedProviders) {
          if (p.apiKey) {
            await invoke("secure_set_api_key", { providerId: p.name, key: p.apiKey }).catch(
              () => {},
            );
            p.apiKey = undefined;
            migrated = true;
          } else {
            const key = await invoke<string | null>("secure_get_api_key", {
              providerId: p.name,
            }).catch(() => null);
            p.apiKey = key ?? undefined;
            if (!key) {
              console.warn(`[ai] provider "${p.name}" 未能从本地数据库取回 API Key，请重新填写。`);
            }
          }
        }
        set({ providers: savedProviders });
        if (migrated) await get().saveProviders();
      }
      const savedActiveId = await store.get<string>("ai_active_provider_id");
      const { providers } = get();
      if (savedActiveId) {
        const found = providers.find((p) => p.name === savedActiveId);
        if (found) set({ activeProvider: found });
      }
      const { activeProvider } = get();
      if (!activeProvider && providers.length > 0) {
        set({ activeProvider: providers[0] });
        await store.set("ai_active_provider_id", providers[0].name);
        await store.save();
      }
    } catch (error) {
      console.error("Failed to load providers:", error);
    }
  },

  saveProviders: async () => {
    const store = await getStore();
    const { providers } = get();
    for (const p of providers) {
      if (p.apiKey) {
        await invoke("secure_set_api_key", { providerId: p.name, key: p.apiKey });
      }
    }
    const toStore = providers.map((p) => {
      const copy = { ...p };
      delete copy.apiKey;
      return copy;
    });
    await store.set("ai_providers", toStore);
    await store.save();
  },

  addProvider: async (config) => {
    set((s) => ({ providers: [...s.providers, config] }));
    await get().saveProviders();
    const { activeProvider } = get();
    if (!activeProvider) {
      set({ activeProvider: config });
      const store = await getStore();
      await store.set("ai_active_provider_id", config.name);
      await store.save();
    }
  },

  updateProvider: async (index, config) => {
    const { providers, activeProvider } = get();
    if (index < 0 || index >= providers.length) return;
    const isActive = activeProvider === providers[index];
    const newProviders = [...providers];
    newProviders[index] = config;
    set({ providers: newProviders });
    await get().saveProviders();
    if (isActive) {
      set({ activeProvider: config });
      const store = await getStore();
      await store.set("ai_active_provider_id", config.name);
      await store.save();
    }
  },

  removeProvider: async (index) => {
    const { providers, activeProvider } = get();
    const removed = providers[index];
    const wasActive = activeProvider === providers[index];
    const newProviders = providers.filter((_, i) => i !== index);
    if (removed?.name) {
      await invoke("secure_delete_api_key", { providerId: removed.name }).catch(() => {});
    }
    set({ providers: newProviders });
    await get().saveProviders();
    if (wasActive) {
      const next = newProviders[0] || null;
      set({ activeProvider: next });
      const store = await getStore();
      if (next) await store.set("ai_active_provider_id", next.name);
      else await store.delete("ai_active_provider_id");
      await store.save();
    }
  },

  setActiveProvider: (config) => {
    set({ activeProvider: config });
    (async () => {
      const store = await getStore();
      await store.set("ai_active_provider_id", config.name);
      await store.save();
    })();
  },

  chat: async (messages) => {
    const { activeProvider } = get();
    if (!activeProvider) throw new Error("No active provider");
    const request: ChatRequest = {
      provider: activeProvider.provider,
      model: activeProvider.defaultModel,
      messages,
      apiKey: activeProvider.apiKey,
      baseUrl: activeProvider.baseUrl,
      temperature: 0.7,
      maxTokens: 2048,
      stream: false,
    };
    return invoke<ChatResponse>("ai_chat", { request });
  },

  chatStream: async (messages, onChunk) => {
    const { activeProvider, isStreaming } = get();
    if (!activeProvider) throw new Error("No active provider");
    if (isStreaming) throw new Error("已有进行中的生成，请先取消当前生成");

    set({ isStreaming: true, streamContent: "" });

    const sessionId = newSessionId();
    currentSessionId = sessionId;
    const eventName = `ai-stream-chunk-${sessionId}`;

    const unlisten = await listen<StreamChunk>(eventName, (event) => {
      const chunk = event.payload;
      if (chunk.content) {
        set((s) => ({ streamContent: s.streamContent + chunk.content }));
        onChunk(chunk.content);
      }
    });
    unlistenStream = unlisten;

    try {
      const { aiTemperature, aiMaxTokens } = useSettingsStore.getState();
      const request: ChatRequest = {
        provider: activeProvider.provider,
        model: activeProvider.defaultModel,
        messages,
        apiKey: activeProvider.apiKey,
        baseUrl: activeProvider.baseUrl,
        temperature: aiTemperature,
        maxTokens: aiMaxTokens,
        stream: true,
        sessionId,
      };
      return await invoke<ChatResponse>("ai_chat_stream", { request });
    } finally {
      set({ isStreaming: false });
      unlisten();
      unlistenStream = null;
      currentSessionId = null;
    }
  },

  cancelStream: () => {
    if (unlistenStream) {
      unlistenStream();
      unlistenStream = null;
    }
    set({ isStreaming: false });
    const sid = currentSessionId;
    currentSessionId = null;
    if (sid) {
      invoke("ai_cancel_stream", { sessionId: sid }).catch(() => {});
    }
  },

  listModels: async (provider) => {
    return invoke<string[]>("list_models", {
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
    });
  },

  testConnection: async (provider) => {
    return invoke<boolean>("test_connection", {
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
    });
  },

  addToHistory: (message) => {
    set((s) => {
      const history = [...s.chatHistory, message];
      if (history.length > MAX_HISTORY) {
        return { chatHistory: history.slice(-MAX_HISTORY) };
      }
      return { chatHistory: history };
    });
  },

  clearHistory: () => set({ chatHistory: [] }),
}));
