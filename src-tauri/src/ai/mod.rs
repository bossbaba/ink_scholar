pub mod ollama;
pub mod openai_compat;
pub mod stream_util;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::models::ai::{AiProvider, ChatRequest, ChatResponse, StreamChunk};
use ollama::OllamaProvider;
use openai_compat::OpenAICompatProvider;

pub enum AiProviderImpl {
    Ollama(OllamaProvider),
    OpenAICompat(OpenAICompatProvider),
}

impl AiProviderImpl {
    pub fn new(provider: AiProvider) -> Self {
        match provider {
            AiProvider::ollama => AiProviderImpl::Ollama(OllamaProvider::new()),
            AiProvider::openai_compat => AiProviderImpl::OpenAICompat(OpenAICompatProvider::new()),
        }
    }

    pub async fn chat(&self, request: &ChatRequest) -> Result<ChatResponse, String> {
        match self {
            AiProviderImpl::Ollama(p) => p.chat(request).await,
            AiProviderImpl::OpenAICompat(p) => p.chat(request).await,
        }
    }

    pub async fn chat_stream(
        &self,
        request: &ChatRequest,
        on_chunk: impl Fn(StreamChunk) + Send + 'static,
        abort: Arc<AtomicBool>,
    ) -> Result<ChatResponse, String> {
        match self {
            AiProviderImpl::Ollama(p) => p.chat_stream(request, on_chunk, abort).await,
            AiProviderImpl::OpenAICompat(p) => p.chat_stream(request, on_chunk, abort).await,
        }
    }

    pub async fn list_models(
        &self,
        base_url: &str,
        api_key: Option<&str>,
    ) -> Result<Vec<String>, String> {
        match self {
            AiProviderImpl::Ollama(p) => p.list_models(base_url).await,
            AiProviderImpl::OpenAICompat(p) => p.list_models(base_url, api_key).await,
        }
    }

    pub async fn test_connection(
        &self,
        base_url: &str,
        api_key: Option<&str>,
    ) -> Result<bool, String> {
        match self {
            AiProviderImpl::Ollama(p) => p.test_connection(base_url).await,
            AiProviderImpl::OpenAICompat(p) => p.test_connection(base_url, api_key).await,
        }
    }
}
