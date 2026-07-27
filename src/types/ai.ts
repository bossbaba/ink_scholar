export type AiProviderType = "ollama" | "openai_compat";

export interface AiProviderConfig {
  provider: AiProviderType;
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  availableModels: string[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  provider: AiProviderType;
  model: string;
  messages: ChatMessage[];
  apiKey?: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  sessionId?: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamChunk {
  content: string;
  done: boolean;
}
