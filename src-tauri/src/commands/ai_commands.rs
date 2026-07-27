use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::command;
use tauri::Emitter;
use tauri::State;
use crate::models::ai::{AiProvider, ChatRequest, ChatResponse};
use crate::ai::AiProviderImpl;

/// 流式生成的中断信号注册表：按会话 id 持有 `AtomicBool`，
/// 前端调用 `ai_cancel_stream` 时置位，后端流式循环检测到后即停止生成。
pub struct StreamAborts(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

impl Default for StreamAborts {
    fn default() -> Self {
        StreamAborts(Mutex::new(HashMap::new()))
    }
}

/// 生成一个基于时间戳纳秒的会话 id（避免引入额外依赖）。
fn new_session_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("s{}", nanos)
}

#[command]
pub async fn ai_chat(request: ChatRequest) -> Result<ChatResponse, String> {
    let provider = AiProviderImpl::new(request.provider.clone());
    provider.chat(&request).await
}

#[command]
pub async fn ai_chat_stream(
    app: tauri::AppHandle,
    aborts: State<'_, StreamAborts>,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    let provider = AiProviderImpl::new(request.provider.clone());

    // 每个请求一个独立会话 id，事件名带上 id 避免多路并发时互相串扰。
    let session_id = request
        .session_id
        .clone()
        .unwrap_or_else(new_session_id);
    let abort = Arc::new(AtomicBool::new(false));
    aborts
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(session_id.clone(), abort.clone());

    let event_name = format!("ai-stream-chunk-{}", session_id);
    let app_handle = app.clone();
    let result = provider
        .chat_stream(
            &request,
            move |chunk| {
                let _ = app_handle.emit(&event_name, chunk);
            },
            abort.clone(),
        )
        .await;

    aborts
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&session_id);
    result
}

/// 取消指定会话的流式生成（仅置中断标志，不返回错误）。
#[command]
pub fn ai_cancel_stream(session_id: String, aborts: State<StreamAborts>) {
    if let Some(flag) = aborts
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&session_id)
    {
        flag.store(true, Ordering::Relaxed);
    }
}

#[command]
pub async fn list_models(
    provider: AiProvider,
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let provider_impl = AiProviderImpl::new(provider);
    provider_impl.list_models(&base_url, api_key.as_deref()).await
}

#[command]
pub async fn test_connection(
    provider: AiProvider,
    base_url: String,
    api_key: Option<String>,
) -> Result<bool, String> {
    let provider_impl = AiProviderImpl::new(provider);
    provider_impl.test_connection(&base_url, api_key.as_deref()).await
}
