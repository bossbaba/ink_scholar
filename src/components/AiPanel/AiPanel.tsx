import {
  BulbOutlined,
  FileTextOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Bubble, Sender } from "@ant-design/x";
import { Button, message, Tabs } from "antd";
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
  const [messages, setMessages] = useState<TabMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [generating, setGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
  }, [messages]);

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
      if (!userText.trim() || generating) return;
      setGenerating(true);
      const newMessages = [...messages, mkMsg("user", userText)];
      setMessages(newMessages);
      setInputValue("");

      try {
        const chatMessages: ChatMessage[] = [
          ...buildContextMessages(),
          ...newMessages.map((m) => ({ role: m.role, content: m.content })),
        ];

        let assistantContent = "";
        setMessages((prev) => [...prev, mkMsg("assistant", "")]);

        await aiStore.chatStream(chatMessages, (chunk) => {
          assistantContent += chunk;
          setMessages((prev) => {
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
        setMessages((prev) => [...prev, mkMsg("assistant", "请求失败，请重试。")]);
      } finally {
        setGenerating(false);
      }
    },
    [messages, generating, aiStore, buildContextMessages],
  );

  // 通用流式任务：先放置稳定的 user/assistant 两条消息（id 仅在创建时生成一次），
  // 流式过程中只增量更新 assistant 那条的内容，避免每片 chunk 都重建整个数组，
  // 导致 Bubble 反复重挂载与滚动跳动（原 handleContinue/Inspiration/Optimize 的 bug）。
  const runAssistantTask = useCallback(
    async (userLabel: string, buildChatMessages: () => ChatMessage[]) => {
      if (generating) return;
      setGenerating(true);
      const userMsg = mkMsg("user", userLabel);
      const assistantMsg = mkMsg("assistant", "");
      setMessages([userMsg, assistantMsg]);
      try {
        const chatMessages = buildChatMessages();
        let content = "";
        await aiStore.chatStream(chatMessages, (chunk) => {
          content += chunk;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content } : m)),
          );
        });
      } catch (err) {
        message.error(err instanceof Error ? err.message : "生成失败");
      } finally {
        setGenerating(false);
      }
    },
    [generating, aiStore],
  );

  const handleContinue = useCallback(async () => {
    if (!currentChapter) return;
    const novelCtx = currentNovel ? buildNovelContext(currentNovel) : undefined;
    await runAssistantTask("请继续写作", () => {
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
      await runAssistantTask(`灵感：${direction}`, () => {
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
      await runAssistantTask(`优化文本：${text.slice(0, 100)}...`, () => {
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

  // Reset messages when switching tabs
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab is intentionally used only as a trigger to reset draft state on tab switch, not read inside the closure
  useEffect(() => {
    setMessages([]);
    setInputValue("");
  }, [activeTab]);

  const noProvider = !aiStore.activeProvider;

  const tabItems = [
    {
      key: "chat",
      label: (
        <span>
          <SendOutlined /> 对话
        </span>
      ),
      children: (
        <ChatTab
          messages={messages}
          inputValue={inputValue}
          setInputValue={setInputValue}
          onSend={sendChat}
          generating={generating}
          noProvider={noProvider}
          messagesEndRef={messagesEndRef}
        />
      ),
    },
    {
      key: "continue",
      label: (
        <span>
          <FileTextOutlined /> 续写
        </span>
      ),
      children: (
        <ActionTab
          title="AI 续写"
          description="基于当前章节内容，AI 将为你续写故事"
          buttonText="开始续写"
          onAction={handleContinue}
          messages={messages}
          generating={generating}
          noProvider={noProvider}
          messagesEndRef={messagesEndRef}
        />
      ),
    },
    {
      key: "inspiration",
      label: (
        <span>
          <BulbOutlined /> 灵感
        </span>
      ),
      children: (
        <InputActionTab
          title="灵感生成"
          placeholder="描述你想要的灵感方向..."
          buttonText="生成灵感"
          onAction={handleInspiration}
          messages={messages}
          inputValue={inputValue}
          setInputValue={setInputValue}
          generating={generating}
          noProvider={noProvider}
          messagesEndRef={messagesEndRef}
        />
      ),
    },
    {
      key: "optimize",
      label: (
        <span>
          <ThunderboltOutlined /> 优化
        </span>
      ),
      children: (
        <InputActionTab
          title="文本优化"
          placeholder="粘贴需要优化的文本..."
          buttonText="优化文本"
          onAction={handleOptimize}
          messages={messages}
          inputValue={inputValue}
          setInputValue={setInputValue}
          generating={generating}
          noProvider={noProvider}
          messagesEndRef={messagesEndRef}
        />
      ),
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--c-surface)",
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        size="small"
        className="ai-tabs"
        tabBarStyle={{ padding: "0 16px", marginBottom: 0 }}
      />
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
