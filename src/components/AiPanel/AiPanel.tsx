import {
  BulbOutlined,
  FileTextOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Bubble, Sender } from "@ant-design/x";
import { Button, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildNovelContext } from "@/services/novelContext";
import { PROMPTS } from "@/services/prompts";
import { useAiStore } from "@/stores/useAiStore";
import { useNovelStore } from "@/stores/useNovelStore";
import type { ChatMessage } from "@/types";

interface TabMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

let msgSeq = 0;
const mkMsg = (role: TabMessage["role"], content: string): TabMessage => ({
  id: `msg-${msgSeq++}`,
  role,
  content,
});

export default function AiPanel() {
  const aiStore = useAiStore();
  const [activeTab, setActiveTab] = useState("chat");
  // 每个 tab 独立保存各自的对话历史，避免切换 tab 时互相覆盖导致对话丢失
  const [messagesByTab, setMessagesByTab] = useState<Record<string, TabMessage[]>>({});
  // 每个 tab 独立的输入框草稿
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  // 每个 tab 独立的生成中状态
  const [generatingByTab, setGeneratingByTab] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeMessages = messagesByTab[activeTab] ?? [];

  // 按 tab 读写对话历史
  const setTabMessages = useCallback(
    (tab: string, updater: (prev: TabMessage[]) => TabMessage[]) => {
      setMessagesByTab((prev) => ({ ...prev, [tab]: updater(prev[tab] ?? []) }));
    },
    [],
  );
  const setTabInput = useCallback((tab: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [tab]: value }));
  }, []);
  const isGenerating = useCallback(
    (tab: string) => generatingByTab[tab] === true,
    [generatingByTab],
  );
  const setGenerating = useCallback((tab: string, value: boolean) => {
    setGeneratingByTab((prev) => ({ ...prev, [tab]: value }));
  }, []);

  const currentNovel = useNovelStore((s) => s.currentNovel);
  const activeChapterId = useNovelStore((s) => s.activeChapterId);
  // 响应式计算当前章节：订阅 currentNovel 与 activeChapterId，
  // 切章（仅改 activeChapterId，currentNovel 引用不变）时也能正确重渲染，
  // 避免续写/优化作用于错误章节正文。
  const currentChapter = useMemo(() => {
    if (!currentNovel || currentNovel.chapters.length === 0) return null;
    if (activeChapterId) {
      const matched = currentNovel.chapters.find((c) => c.id === activeChapterId);
      if (matched) return matched;
    }
    return currentNovel.chapters[0];
  }, [currentNovel, activeChapterId]);

  // Scroll to bottom
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll chat list to bottom whenever messages change (timing dependency; messages is not read inside the closure)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages, activeTab]);

  const buildContextMessages = useCallback((): ChatMessage[] => {
    const contextMessages: ChatMessage[] = [];
    if (currentNovel) {
      contextMessages.push({
        role: "system",
        content: `你是一位专业的小说创作AI助手。当前作品：《${currentNovel.title}》，类型：${currentNovel.genre}，作者：${currentNovel.author}。${currentChapter ? `当前章节：${currentChapter.title}` : ""}`,
      });
    }
    return contextMessages;
  }, [currentNovel, currentChapter]);

  const sendChat = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isGenerating("chat")) return;
      setGenerating("chat", true);
      const tab = "chat";
      const existing = messagesByTab[tab] ?? [];
      const userMsg = mkMsg("user", userText);
      const assistantMsg = mkMsg("assistant", "");
      setTabMessages(tab, (prev) => [...prev, userMsg, assistantMsg]);
      setTabInput(tab, "");

      try {
        const chatMessages: ChatMessage[] = [
          ...buildContextMessages(),
          ...[...existing, userMsg].map((m) => ({ role: m.role, content: m.content })),
        ];

        let assistantContent = "";
        await aiStore.chatStream(chatMessages, (chunk) => {
          assistantContent += chunk;
          setTabMessages(tab, (prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: assistantContent,
            };
            return updated;
          });
        });
      } catch (err) {
        message.error(err instanceof Error ? err.message : "AI 请求失败");
        setTabMessages(tab, (prev) => [...prev, mkMsg("assistant", "请求失败，请重试。")]);
      } finally {
        setGenerating("chat", false);
      }
    },
    [messagesByTab, aiStore, buildContextMessages, isGenerating, setTabMessages, setTabInput, setGenerating],
  );

  // 通用流式任务：先放置稳定的 user/assistant 两条消息（id 仅在创建时生成一次），
  // 流式过程中只增量更新 assistant 那条的内容，避免每片 chunk 都重建整个数组，
  // 导致 Bubble 反复重挂载与滚动跳动（原 handleContinue/Inspiration/Optimize 的 bug）。
  // 每个 tab 独立保存对话，切换 tab 不会丢失也不会互相覆盖。
  const runAssistantTask = useCallback(
    async (
      tab: string,
      userLabel: string,
      buildChatMessages: () => ChatMessage[],
    ) => {
      if (isGenerating(tab)) return;
      setGenerating(tab, true);
      const userMsg = mkMsg("user", userLabel);
      const assistantMsg = mkMsg("assistant", "");
      setTabMessages(tab, () => [userMsg, assistantMsg]);
      try {
        const chatMessages = buildChatMessages();
        let content = "";
        await aiStore.chatStream(chatMessages, (chunk) => {
          content += chunk;
          setTabMessages(tab, (prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content } : m)),
          );
        });
      } catch (err) {
        message.error(err instanceof Error ? err.message : "生成失败");
      } finally {
        setGenerating(tab, false);
      }
    },
    [aiStore, isGenerating, setTabMessages, setGenerating],
  );

  const handleContinue = useCallback(async () => {
    if (!currentChapter) return;
    const novelCtx = currentNovel ? buildNovelContext(currentNovel) : undefined;
    await runAssistantTask("continue", "请继续写作", () => {
      const msgs = PROMPTS.continueWriting(currentChapter.content || "", undefined, novelCtx);
      const chatMessages: ChatMessage[] = [
        ...buildContextMessages(),
        ...msgs.filter((m) => m.role !== "system"),
      ];
      if (msgs[0]?.role === "system") chatMessages.unshift(msgs[0]);
      return chatMessages;
    });
  }, [currentChapter, currentNovel, runAssistantTask, buildContextMessages]);

  const handleInspiration = useCallback(
    async (direction: string) => {
      if (!direction.trim()) return;
      const novelCtx = currentNovel ? buildNovelContext(currentNovel) : undefined;
      await runAssistantTask("inspiration", `灵感：${direction}`, () => {
        const msgs = PROMPTS.buildInspiration(direction, currentNovel?.genre || "通用", novelCtx);
        const chatMessages: ChatMessage[] = [
          ...buildContextMessages(),
          ...msgs.filter((m) => m.role !== "system"),
        ];
        if (msgs[0]?.role === "system") chatMessages.unshift(msgs[0]);
        return chatMessages;
      });
    },
    [currentNovel, runAssistantTask, buildContextMessages],
  );

  const handleOptimize = useCallback(
    async (text: string) => {
      if (!text) return;
      const novelCtx = currentNovel ? buildNovelContext(currentNovel) : undefined;
      await runAssistantTask("optimize", `优化文本：${text.slice(0, 100)}...`, () => {
        const msgs = PROMPTS.optimizeSentence(text, novelCtx);
        const chatMessages: ChatMessage[] = [
          ...buildContextMessages(),
          ...msgs.filter((m) => m.role !== "system"),
        ];
        if (msgs[0]?.role === "system") chatMessages.unshift(msgs[0]);
        return chatMessages;
      });
    },
    [currentNovel, runAssistantTask, buildContextMessages],
  );

  const noProvider = !aiStore.activeProvider;

  const TABS = [
    { key: "chat", label: "对话", icon: <SendOutlined /> },
    { key: "continue", label: "续写", icon: <FileTextOutlined /> },
    { key: "inspiration", label: "灵感", icon: <BulbOutlined /> },
    { key: "optimize", label: "优化", icon: <ThunderboltOutlined /> },
  ];

  return (
    <div className="ai-panel">
      <div className="ai-tabbar" role="tablist" aria-label="AI 功能">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={`ai-tabbar__item${activeTab === t.key ? " is-active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="ai-body">
        {activeTab === "chat" && (
          <ChatTab
            messages={activeMessages}
            inputValue={inputValues["chat"] ?? ""}
            setInputValue={(v) => setTabInput("chat", v)}
            onSend={sendChat}
            generating={isGenerating("chat")}
            noProvider={noProvider}
            messagesEndRef={messagesEndRef}
          />
        )}
        {activeTab === "continue" && (
          <ActionTab
            title="AI 续写"
            description="基于当前章节内容，AI 将为你续写故事"
            buttonText="开始续写"
            onAction={handleContinue}
            messages={activeMessages}
            generating={isGenerating("continue")}
            noProvider={noProvider}
            messagesEndRef={messagesEndRef}
          />
        )}
        {activeTab === "inspiration" && (
          <InputActionTab
            title="灵感生成"
            placeholder="描述你想要的灵感方向..."
            buttonText="生成灵感"
            onAction={handleInspiration}
            messages={activeMessages}
            inputValue={inputValues["inspiration"] ?? ""}
            setInputValue={(v) => setTabInput("inspiration", v)}
            generating={isGenerating("inspiration")}
            noProvider={noProvider}
            messagesEndRef={messagesEndRef}
          />
        )}
        {activeTab === "optimize" && (
          <InputActionTab
            title="文本优化"
            placeholder="粘贴需要优化的文本..."
            buttonText="优化文本"
            onAction={handleOptimize}
            messages={activeMessages}
            inputValue={inputValues["optimize"] ?? ""}
            setInputValue={(v) => setTabInput("optimize", v)}
            generating={isGenerating("optimize")}
            noProvider={noProvider}
            messagesEndRef={messagesEndRef}
          />
        )}
      </div>
    </div>
  );
}

// ===== Chat Tab =====
function ChatTab({
  messages,
  inputValue,
  setInputValue,
  onSend,
  generating,
  noProvider,
  messagesEndRef,
}: {
  messages: TabMessage[];
  inputValue: string;
  setInputValue: (v: string) => void;
  onSend: (text: string) => void;
  generating: boolean;
  noProvider: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="ai-tab">
      <div className="ai-messages">
        {messages.length === 0 ? (
          <div className="ai-messages__empty">
            {noProvider ? "请先在设置中配置 AI Provider" : "和 AI 聊聊你的创作想法"}
          </div>
        ) : (
          messages.map((msg) => (
            <Bubble
              key={msg.id}
              content={msg.content}
              placement={msg.role === "user" ? "end" : "start"}
              variant={msg.role === "user" ? "filled" : "outlined"}
              loading={msg.role === "assistant" && !msg.content && generating}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="ai-sender">
        <Sender
          value={inputValue}
          onChange={setInputValue}
          onSubmit={() => {
            onSend(inputValue);
          }}
          placeholder="输入消息..."
          disabled={noProvider || generating}
          loading={generating}
        />
      </div>
    </div>
  );
}

// ===== Action Tab (Continue) =====
function ActionTab({
  title,
  description,
  buttonText,
  onAction,
  messages,
  generating,
  noProvider,
  messagesEndRef,
}: {
  title: string;
  description: string;
  buttonText: string;
  onAction: () => void;
  messages: TabMessage[];
  generating: boolean;
  noProvider: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="ai-tab">
      <div className="ai-messages">
        {messages.length === 0 ? (
          <div className="ai-messages__empty">
            <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: "var(--c-text-1)" }}>
              {title}
            </p>
            <p style={{ color: "var(--c-text-4)", marginBottom: 24 }}>{description}</p>
            <Button type="primary" onClick={onAction} disabled={noProvider}>
              {buttonText}
            </Button>
          </div>
        ) : (
          messages.map((msg) => (
            <Bubble
              key={msg.id}
              content={msg.content}
              placement={msg.role === "user" ? "end" : "start"}
              variant={msg.role === "user" ? "filled" : "outlined"}
              loading={msg.role === "assistant" && !msg.content && generating}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      {messages.length > 0 && (
        <div className="ai-sender">
          <Button
            block
            type="primary"
            onClick={onAction}
            loading={generating}
            disabled={noProvider}
          >
            {buttonText}
          </Button>
        </div>
      )}
    </div>
  );
}

// ===== Input Action Tab (Inspiration/Optimize) =====
function InputActionTab({
  title,
  placeholder,
  onAction,
  messages,
  inputValue,
  setInputValue,
  generating,
  noProvider,
  messagesEndRef,
}: {
  title: string;
  placeholder: string;
  buttonText: string;
  onAction: (text: string) => void;
  messages: TabMessage[];
  inputValue: string;
  setInputValue: (v: string) => void;
  generating: boolean;
  noProvider: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="ai-tab">
      <div className="ai-messages">
        {messages.length === 0 ? (
          <div className="ai-messages__empty">
            <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: "var(--c-text-1)" }}>
              {title}
            </p>
            <p>{noProvider ? "请先在设置中配置 AI Provider" : "输入内容后点击按钮"}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <Bubble
              key={msg.id}
              content={msg.content}
              placement={msg.role === "user" ? "end" : "start"}
              variant={msg.role === "user" ? "filled" : "outlined"}
              loading={msg.role === "assistant" && !msg.content && generating}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="ai-sender">
        <Sender
          value={inputValue}
          onChange={setInputValue}
          onSubmit={() => {
            onAction(inputValue);
            setInputValue("");
          }}
          placeholder={placeholder}
          disabled={noProvider || generating}
          loading={generating}
        />
      </div>
    </div>
  );
}
