use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde_json::json;
use serde_json::Value;
use tracing::warn;

use crate::ai::stream_util::{get_json, post_json, stream_chat_completion, LineAction};
use crate::models::ai::{ChatRequest, ChatResponse, StreamChunk};

pub struct OllamaProvider;

impl OllamaProvider {
    pub fn new() -> Self {
        OllamaProvider
    }

    pub async fn chat(&self, request: &ChatRequest) -> Result<ChatResponse, String> {
        let url = format!("{}/api/chat", request.base_url);
        let messages: Vec<Value> = request
            .messages
            .iter()
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect();
        let body = json!({
            "model": request.model,
            "messages": messages,
            "stream": false,
            "think": false,
            "options": {
                "temperature": request.temperature,
                "num_predict": request.max_tokens
            }
        });
        let json = post_json(|b| b, &url, body).await?;
        let content = json["message"]["content"].as_str().unwrap_or("").to_string();
        Ok(ChatResponse {
            content,
            model: request.model.clone(),
            usage: None,
        })
    }

    pub async fn chat_stream(
        &self,
        request: &ChatRequest,
        on_chunk: impl Fn(StreamChunk) + Send + 'static,
        abort: Arc<AtomicBool>,
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/api/chat", request.base_url);
        let messages: Vec<Value> = request
            .messages
            .iter()
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect();
        let body = json!({
            "model": request.model,
            "messages": messages,
            "stream": true,
            "think": false,
            "options": {
                "temperature": request.temperature,
                "num_predict": request.max_tokens
            }
        });

        // 推理模型（如 Qwen3）把思维链放在 `thinking` 字段；用 Arc<Mutex> 在
        // 闭包内累积，仅当正文为空时作为兜底内容返回，避免界面空白。
        let thinking = Arc::new(Mutex::new(String::new()));
        let thinking_c = thinking.clone();

        let full = stream_chat_completion(
            &url,
            |b| b,
            body,
            abort,
            on_chunk,
            move |line: &str| -> LineAction {
                if let Ok(json) = serde_json::from_str::<Value>(line) {
                    // Ollama 错误响应：{"error":"model 'xxx' not found"}
                    if let Some(error) = json["error"].as_str() {
                        return LineAction::Error(format!("Ollama 返回错误：{}", error));
                    }
                    if let Some(content) = json["message"]["content"].as_str() {
                        if !content.is_empty() {
                            return LineAction::Content(content.to_string());
                        }
                    }
                    if let Some(t) = json["message"]["thinking"].as_str() {
                        if !t.is_empty() {
                            thinking_c.lock().unwrap().push_str(t);
                        }
                    }
                    if json["done"].as_bool().unwrap_or(false) {
                        return LineAction::Done;
                    }
                } else {
                    warn!("[ollama] 无法解析 NDJSON line: {}", line);
                }
                LineAction::Skip
            },
        )
        .await?;

        if full.is_empty() {
            let thinking_text = thinking.lock().unwrap().clone();
            if !thinking_text.is_empty() {
                return Ok(ChatResponse {
                    content: format!("[模型思考过程]\n{}", thinking_text),
                    model: request.model.clone(),
                    usage: None,
                });
            }
            return Err(
                "Ollama 返回了空内容。可能原因：1) 当前模型不支持流式输出；2) 模型尚未下载或加载失败；3) baseUrl/model 配置不正确。请检查 Ollama 服务日志。"
                    .to_string(),
            );
        }

        Ok(ChatResponse {
            content: full,
            model: request.model.clone(),
            usage: None,
        })
    }

    pub async fn list_models(&self, base_url: &str) -> Result<Vec<String>, String> {
        let url = format!("{}/api/tags", base_url);
        let json = get_json(|b| b, &url).await?;
        let models = json["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        Ok(models)
    }

    pub async fn test_connection(&self, base_url: &str) -> Result<bool, String> {
        let url = format!("{}/api/tags", base_url);
        match get_json(|b| b, &url).await {
            Ok(_) => Ok(true),
            Err(e) => Err(format!("无法连接到 Ollama: {}", e)),
        }
    }
}
