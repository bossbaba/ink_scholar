use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde_json::json;
use serde_json::Value;

use crate::ai::stream_util::{get_json, post_json, stream_chat_completion, LineAction};
use crate::models::ai::{ChatRequest, ChatResponse, StreamChunk};

pub struct OpenAICompatProvider;

impl OpenAICompatProvider {
    pub fn new() -> Self {
        OpenAICompatProvider
    }

    /// 拼接 OpenAI 兼容服务的 URL，兼容 baseUrl 已含 /v1 的写法。
    fn join_v1_path(base: &str, path: &str) -> String {
        let base_trimmed = base.trim_end_matches('/');
        // 仅当 base 正好以 /v1 结尾时去掉，避免误伤 /v1.0、/api/v1 等合法前缀
        let base_trimmed = if base_trimmed.ends_with("/v1") {
            &base_trimmed[..base_trimmed.len() - 3]
        } else {
            base_trimmed
        };
        let path_trimmed = path.trim_start_matches('/');
        format!("{}/{}", base_trimmed, path_trimmed)
    }

    pub async fn chat(&self, request: &ChatRequest) -> Result<ChatResponse, String> {
        let url = Self::join_v1_path(&request.base_url, "/v1/chat/completions");
        let messages: Vec<Value> = request
            .messages
            .iter()
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect();
        let body = json!({
            "model": request.model,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": false
        });

        let json = post_json(
            |b| {
                let mut b = b;
                if let Some(api_key) = &request.api_key {
                    b = b.header("Authorization", format!("Bearer {}", api_key));
                }
                b
            },
            &url,
            body,
        )
        .await?;

        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();
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
        let url = Self::join_v1_path(&request.base_url, "/v1/chat/completions");
        let messages: Vec<Value> = request
            .messages
            .iter()
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect();
        let body = json!({
            "model": request.model,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": true
        });

        let full = stream_chat_completion(
            &url,
            |b| {
                let mut b = b;
                if let Some(api_key) = &request.api_key {
                    b = b.header("Authorization", format!("Bearer {}", api_key));
                }
                b
            },
            body,
            abort,
            on_chunk,
            |line: &str| -> LineAction {
                // 标准 OpenAI SSE 以 "data: " 开头；某些兼容接口直接返回 JSON Lines。
                let data = if line.starts_with("data: ") {
                    &line[6..]
                } else {
                    line
                };

                if data == "[DONE]" {
                    return LineAction::Done;
                }

                if let Ok(json) = serde_json::from_str::<Value>(data) {
                    // 处理 OpenAI 错误响应，如 {"error":{"message":"..."}}
                    if let Some(error_msg) = json["error"]["message"].as_str() {
                        return LineAction::Error(format!("AI 服务返回错误：{}", error_msg));
                    }
                    if let Some(error_str) = json["error"].as_str() {
                        return LineAction::Error(format!("AI 服务返回错误：{}", error_str));
                    }

                    let content = json["choices"][0]["delta"]["content"]
                        .as_str()
                        .or_else(|| json["choices"][0]["message"]["content"].as_str())
                        .or_else(|| json["choices"][0]["text"].as_str())
                        .or_else(|| json["message"]["content"].as_str())
                        .or_else(|| json["content"].as_str())
                        .unwrap_or("");
                    if !content.is_empty() {
                        return LineAction::Content(content.to_string());
                    }
                }
                LineAction::Skip
            },
        )
        .await?;

        if full.is_empty() {
            return Err(
                "AI 返回了空内容。可能原因：1) 模型不支持流式输出；2) 返回格式非标准 SSE/JSON Lines；3) 模型配置（baseUrl/model/apiKey）不正确。请检查终端日志或 AI 配置。"
                    .to_string(),
            );
        }

        Ok(ChatResponse {
            content: full,
            model: request.model.clone(),
            usage: None,
        })
    }

    pub async fn list_models(
        &self,
        base_url: &str,
        api_key: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let url = Self::join_v1_path(base_url, "/v1/models");
        let json = get_json(
            |b| {
                let mut b = b;
                if let Some(api_key) = api_key {
                    b = b.header("Authorization", format!("Bearer {}", api_key));
                }
                b
            },
            &url,
        )
        .await?;
        let models = json["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        Ok(models)
    }

    pub async fn test_connection(
        &self,
        base_url: &str,
        api_key: Option<&str>,
    ) -> Result<bool, String> {
        let url = Self::join_v1_path(base_url, "/v1/models");

        let client = crate::ai::stream_util::http_client();
        let mut req_builder = client.get(&url);
        if let Some(api_key) = api_key {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
        }

        match req_builder.send().await {
            Ok(response) => {
                if response.status().is_success() {
                    Ok(true)
                } else {
                    let status = response.status();
                    let err = if status.as_u16() == 404 {
                        // 404 在 OpenAI 兼容服务里几乎都是 baseUrl 拼错：
                        // 用户可能填了 `https://xxx.com/v1`（已含 /v1），代码又拼了一遍 /v1。
                        format!(
                            "API 返回 404（路径不存在）。当前 baseUrl = `{}`。请检查：1) baseUrl 是否已包含 `/v1`（如 `https://xxx.com/v1`），本工具会自动去重；2) 是否需要换成根域名（如 `https://xxx.com`）；3) 该服务是否使用非标准路径前缀（如 `/openapi/v1`）。",
                            base_url
                        )
                    } else {
                        format!("API 返回错误状态码: {}", status)
                    };
                    Err(err)
                }
            }
            Err(e) => Err(format!("无法连接到 API: {}", e)),
        }
    }
}
