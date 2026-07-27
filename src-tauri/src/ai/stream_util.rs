//! AI provider 共用的 HTTP 与流式解析工具。
//!
//! 抽这里是为了消除 ollama / openai_compat 两个 provider 之间约 90% 的重复
//! （见代码审查报告 HIGH-6）：HTTP 客户端创建、请求发送、状态检查、错误读取、
//! SSE/NDJSON 逐行解析循环、abort 中断等逻辑完全一致，差异仅在「如何从一行 JSON
//! 中提取 content / error / done」，这部分交给调用方提供的 `parse_line` 闭包。

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use reqwest::Client;
use serde_json::Value;

use crate::models::ai::StreamChunk;

/// 全局复用的 HTTP 客户端（MD-16）。
///
/// 原先每个 provider 实例在 `new()` 里各自 `Client::builder().build()`，而
/// `AiProviderImpl::new` 每次 AI 命令都会执行，等于每次请求都重建连接池。
/// 这里用 `OnceLock` 保证进程内只建一个连接池，所有 AI 请求共享。
///
/// 仅用于非流式请求（list_models / test_connection / 非流式 chat）。
/// 设 120s 总超时，超时即视为上游异常。
pub fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(120))
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

/// 流式专用客户端（LOW-2）。
///
/// 长篇小说生成可能持续数分钟，若复用 `http_client()` 的 120s 总超时会被中途截断。
/// 这里仅设**建连超时**（30s），不设「整个请求」的总超时，让长生成得以完整接收。
pub fn stream_http_client() -> &'static Client {
    static STREAM_CLIENT: OnceLock<Client> = OnceLock::new();
    STREAM_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

/// 流式行解析的动作指令：`parse_line` 闭包对每一行原始 JSON 返回其中之一。
pub enum LineAction {
    /// 追加文本片段并回调调用方。
    Content(String),
    /// 流正常结束（如 SSE `[DONE]`、Ollama `done:true`）。
    Done,
    /// 忽略该行（如 keep-alive 空行、空 delta）。
    Skip,
    /// 上游返回错误，立即终止整个流并返回 Err。
    Error(String),
}

/// 统一的 SSE / NDJSON 流式读取器。
///
/// 负责：发请求、检查 HTTP 状态、逐字节读取、按行切分、abort 中断；
/// 每行的提取逻辑（content/error/done）由 `parse_line` 闭包决定，从而把
/// Ollama 与 OpenAI 兼容协议的差异收敛到一处。
pub async fn stream_chat_completion<F>(
    url: &str,
    apply_headers: impl FnOnce(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
    body: Value,
    abort: Arc<AtomicBool>,
    on_chunk: impl Fn(StreamChunk) + Send + 'static,
    parse_line: F,
) -> Result<String, String>
where
    F: Fn(&str) -> LineAction + Send + Sync,
{
    let client = stream_http_client();
    let response = apply_headers(client.post(url).json(&body))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<无法读取响应体>".to_string());
        return Err(format!("上游返回错误 {}: {}", status, body));
    }

    let mut full_content = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if abort.load(Ordering::Relaxed) {
            break;
        }
        let chunk = chunk.map_err(|e| {
            format!(
                "流式响应读取失败：{}。可能原因：AI 服务断开、代理/网关压缩不兼容或响应体损坏，请检查服务状态或关闭代理后重试。",
                e
            )
        })?;
        let chunk_str = String::from_utf8_lossy(&chunk);

        for line in chunk_str.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match parse_line(line) {
                LineAction::Content(text) => {
                    full_content.push_str(&text);
                    on_chunk(StreamChunk {
                        content: text,
                        done: false,
                    });
                }
                LineAction::Done => {
                    on_chunk(StreamChunk {
                        content: String::new(),
                        done: true,
                    });
                }
                LineAction::Skip => {}
                LineAction::Error(msg) => return Err(msg),
            }
        }
    }

    Ok(full_content)
}

/// 统一的 POST + JSON 请求：发请求、检查状态、读取并解析响应体。
/// 仅用于非流式 chat 调用，auth 头通过 `apply_headers` 闭包注入。
pub async fn post_json(
    apply_headers: impl FnOnce(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
    url: &str,
    body: Value,
) -> Result<Value, String> {
    let client = http_client();
    let response = apply_headers(client.post(url).json(&body))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<无法读取响应体>".to_string());
        return Err(format!("上游返回错误 {}: {}", status, body));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse response: {}", e))
}

/// 统一的 GET + JSON 请求：用于 list_models / test_connection。
pub async fn get_json(
    apply_headers: impl FnOnce(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
    url: &str,
) -> Result<Value, String> {
    let client = http_client();
    let response = apply_headers(client.get(url))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<无法读取响应体>".to_string());
        return Err(format!("上游返回错误 {}: {}", status, body));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse response: {}", e))
}
