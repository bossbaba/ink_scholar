use serde::{Deserialize, Serialize};

// Tauri 命令参数反序列化会忽略 enum 上的 serde rename，
// 且 enum variant 是"值"不会被 camelCase↔snake_case 重排处理，
// 因此直接用小写 variant 名匹配前端传入的字符串，避免 casing 不匹配。
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AiProvider {
    ollama,
    openai_compat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub provider: AiProvider,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub api_key: Option<String>,
    pub base_url: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub stream: bool,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub content: String,
    pub done: bool,
}
