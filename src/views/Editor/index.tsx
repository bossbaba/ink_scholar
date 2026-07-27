import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  ArrowLeftOutlined,
  BoldOutlined,
  ExportOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button, Divider, message, Spin, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AiPanel from "@/components/AiPanel/AiPanel";
import { useNovelStore } from "@/stores/useNovelStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const novelStore = useNovelStore();
  const settingsStore = useSettingsStore();

  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentNovel = useNovelStore((s) => s.currentNovel);
  // 用稳定选择器取出 action（action 引用在 store 生命周期内不变），避免把整个 store 放进 effect 依赖导致死循环
  const openNovel = useNovelStore((s) => s.openNovel);
  const loadChapterContent = useNovelStore((s) => s.loadChapterContent);
  const saveNovel = useNovelStore((s) => s.saveNovel);
  // 响应式当前章节：同时订阅 activeChapterId，切章（仅改 activeChapterId，currentNovel 引用不变）时也能重渲染
  const activeChapterId = useNovelStore((s) => s.activeChapterId);
  const currentChapter = useMemo(() => {
    if (!currentNovel || currentNovel.chapters.length === 0) return null;
    if (activeChapterId) {
      const matched = currentNovel.chapters.find((c) => c.id === activeChapterId);
      if (matched) return matched;
    }
    return currentNovel.chapters[0];
  }, [currentNovel, activeChapterId]);

  // Load novel on mount
  useEffect(() => {
    if (id) {
      openNovel(id).catch(() => {
        message.error("打开小说失败");
        navigate("/workbench");
      });
    }
  }, [id, navigate, openNovel]);

  // Load chapter content when active chapter changes
  useEffect(() => {
    if (currentChapter && !currentChapter.contentLoaded) {
      loadChapterContent(currentChapter.id);
    }
  }, [currentChapter, loadChapterContent]);

  // Initialize Tiptap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "开始创作你的故事..." }),
      CharacterCount,
      Highlight,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: currentChapter?.content || "",
    onUpdate: ({ editor: e }) => {
      // 用 getState() 取实时章节，避免编辑器实例闭包捕获到切换前的旧章节，
      // 否则切章后继续输入会把内容写回已切走的旧章节。
      const liveChapter = useNovelStore.getState().getCurrentChapter();
      if (liveChapter) {
        novelStore.updateChapterContent(liveChapter.id, e.getHTML());
        // Auto-save with debounce
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => {
          novelStore.saveNovel();
        }, useSettingsStore.getState().autoSaveInterval);
      }
    },
    editorProps: {
      attributes: {
        class: "tiptap-editor-content",
        style: `font-size: ${settingsStore.editorFontSize}px; line-height: 1.8; max-width: 820px; margin: 0 auto; padding: 32px;`,
      },
    },
  });

  // Sync editor content when chapter changes
  useEffect(() => {
    if (editor && currentChapter && editor.getHTML() !== currentChapter.content) {
      editor.commands.setContent(currentChapter.content || "");
    }
  }, [currentChapter, editor]);

  const handleSave = useCallback(async () => {
    try {
      await saveNovel();
      message.success("已保存");
    } catch {
      message.error("保存失败");
    }
  }, [saveNovel]);

  // Save shortcut (Cmd+S)
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [handleSave]);

  const handleAddChapter = async () => {
    const title = `第 ${(currentNovel?.chapters.length || 0) + 1} 章`;
    try {
      const chapter = await novelStore.addChapter(title);
      if (chapter) novelStore.setActiveChapter(chapter.id);
    } catch {
      message.error("添加章节失败");
    }
  };

  const handleExport = async () => {
    if (!(currentNovel && currentChapter)) return;
    const text = currentChapter.content?.replace(/<[^>]*>/gu, "") || "";
    const blob = new Blob([`${currentNovel.title}\n${currentChapter.title}\n\n${text}`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentNovel.title} - ${currentChapter.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    message.success("导出成功");
  };

  if (!currentNovel) {
    return (
      <div
        style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}
      >
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return (
    <div
      style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--c-bg)" }}
    >
      {/* Left: Chapter list */}
      {showOutline && (
        <div
          style={{
            width: 260,
            flexShrink: 0,
            background: "var(--c-surface)",
            borderRight: "1px solid var(--c-border)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              height: 56,
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
              gap: 8,
              borderBottom: "1px solid var(--c-border)",
            }}
          >
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/workbench")}
            />
            <span
              style={{
                flex: 1,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {currentNovel.title}
            </span>
          </div>
          <div style={{ padding: 12, flex: 1, overflow: "auto" }}>
            {currentNovel.chapters.map((chapter) => (
              <button
                key={chapter.id}
                type="button"
                className={`chapter-item${currentChapter?.id === chapter.id ? " is-active" : ""}`}
                onClick={() => novelStore.setActiveChapter(chapter.id)}
              >
                <div className="chapter-item__title">{chapter.title}</div>
                <div className="chapter-item__meta">{chapter.wordCount} 字</div>
              </button>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={handleAddChapter}
              style={{ marginTop: 8 }}
            >
              添加章节
            </Button>
          </div>
        </div>
      )}

      {/* Center: Editor */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Toolbar */}
        <div
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            gap: 4,
            borderBottom: "1px solid var(--c-border)",
            background: "var(--c-surface)",
            flexShrink: 0,
          }}
        >
          <Button type="text" size="small" onClick={() => setShowOutline(!showOutline)}>
            {showOutline ? "收起" : "展开"}
          </Button>
          <Divider type="vertical" />
          {editor && (
            <>
              <ToolbarBtn
                icon={<BoldOutlined />}
                active={editor.isActive("bold")}
                onClick={() => editor.chain().focus().toggleBold().run()}
                tip="粗体"
              />
              <ToolbarBtn
                icon={<ItalicOutlined />}
                active={editor.isActive("italic")}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                tip="斜体"
              />
              <ToolbarBtn
                icon={<UnderlineOutlined />}
                active={editor.isActive("underline")}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                tip="下划线"
              />
              <ToolbarBtn
                icon={<StrikethroughOutlined />}
                active={editor.isActive("strike")}
                onClick={() => editor.chain().focus().toggleStrike().run()}
                tip="删除线"
              />
              <Divider type="vertical" />
              <ToolbarBtn
                icon={<UnorderedListOutlined />}
                active={editor.isActive("bulletList")}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                tip="无序列表"
              />
              <ToolbarBtn
                icon={<OrderedListOutlined />}
                active={editor.isActive("orderedList")}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                tip="有序列表"
              />
              <Divider type="vertical" />
              <ToolbarBtn
                icon={<AlignLeftOutlined />}
                active={editor.isActive({ textAlign: "left" })}
                onClick={() => editor.chain().focus().setTextAlign("left").run()}
                tip="左对齐"
              />
              <ToolbarBtn
                icon={<AlignCenterOutlined />}
                active={editor.isActive({ textAlign: "center" })}
                onClick={() => editor.chain().focus().setTextAlign("center").run()}
                tip="居中"
              />
              <ToolbarBtn
                icon={<AlignRightOutlined />}
                active={editor.isActive({ textAlign: "right" })}
                onClick={() => editor.chain().focus().setTextAlign("right").run()}
                tip="右对齐"
              />
            </>
          )}
          <div style={{ flex: 1 }} />
          {currentChapter && (
            <span style={{ fontSize: 13, color: "var(--c-text-3)", marginRight: 8 }}>
              {currentChapter.title}
            </span>
          )}
          {editor && (
            <span
              style={{ fontSize: 12, color: "var(--c-text-4)", fontFamily: "var(--font-mono)" }}
            >
              {editor.storage.characterCount.characters()} 字
            </span>
          )}
          <Divider type="vertical" />
          <Tooltip title="保存 (⌘S)">
            <Button type="text" size="small" icon={<SaveOutlined />} onClick={handleSave} />
          </Tooltip>
          <Tooltip title="导出">
            <Button type="text" size="small" icon={<ExportOutlined />} onClick={handleExport} />
          </Tooltip>
          <Tooltip title="AI 助手">
            <Button
              type={showAiPanel ? "primary" : "text"}
              size="small"
              icon={<RobotOutlined />}
              onClick={() => setShowAiPanel(!showAiPanel)}
            />
          </Tooltip>
        </div>

        {/* Editor content */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <style>{`
            .tiptap-editor-content { min-height: 100%; outline: none; }
            .tiptap-editor-content p { margin-bottom: 0.8em; }
            .tiptap-editor-content h1 { font-size: 2em; font-weight: 700; margin: 1em 0 0.5em; }
            .tiptap-editor-content h2 { font-size: 1.5em; font-weight: 600; margin: 0.8em 0 0.4em; }
            .tiptap-editor-content h3 { font-size: 1.25em; font-weight: 600; margin: 0.6em 0 0.3em; }
            .tiptap-editor-content ul, .tiptap-editor-content ol { padding-left: 1.5em; margin-bottom: 0.8em; }
            .tiptap-editor-content blockquote { border-left: 3px solid var(--c-border-strong); padding-left: 1em; color: var(--c-text-3); margin: 0.8em 0; }
            .tiptap-editor-content mark { background-color: var(--c-accent-50); padding: 0 2px; border-radius: 2px; }
            .tiptap-editor-content p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--c-text-4); float: left; height: 0; pointer-events: none; }
          `}</style>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Right: AI Panel */}
      {showAiPanel && (
        <div
          style={{
            width: 380,
            flexShrink: 0,
            borderLeft: "1px solid var(--c-border)",
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          <AiPanel />
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({
  icon,
  active,
  onClick,
  tip,
}: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tip: string;
}) {
  return (
    <Tooltip title={tip}>
      <Button
        type="text"
        size="small"
        icon={icon}
        onClick={onClick}
        style={{
          background: active ? "var(--c-primary-50)" : "transparent",
          color: active ? "var(--c-primary-500)" : "var(--c-text-2)",
        }}
      />
    </Tooltip>
  );
}
