import {
  BookOutlined,
  EditOutlined,
  HomeFilled,
  MenuOutlined,
  NodeIndexOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Breadcrumb, Button, Layout, Menu, Modal } from "antd";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAiStore } from "@/stores/useAiStore";
import { useNovelStore } from "@/stores/useNovelStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSkillStore } from "@/stores/useSkillStore";

const { Sider, Header, Content } = Layout;

type SearchGroup = "nav" | "novel" | "chapter";

interface SearchResult {
  id: string;
  title: string;
  meta: string;
  group: SearchGroup;
  action: "navigate" | "open-novel" | "open-chapter";
  path?: string;
  novelId?: string;
  chapterId?: string;
}

const GROUP_META: Record<SearchGroup, { label: string; icon: React.ReactNode }> = {
  nav: { label: "导航", icon: <MenuOutlined /> },
  novel: { label: "作品", icon: <BookOutlined /> },
  chapter: { label: "章节", icon: <EditOutlined /> },
};

const NAV_ITEMS = [
  { key: "/workbench", icon: <HomeFilled />, label: "工作台" },
  { key: "/library", icon: <BookOutlined />, label: "我的作品" },
  { key: "/characters", icon: <NodeIndexOutlined />, label: "角色关系" },
  { key: "/skills", icon: <ThunderboltOutlined />, label: "技能库" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

const PAGE_TITLES: Record<string, string> = {
  "/workbench": "工作台",
  "/library": "我的作品",
  "/characters": "角色关系",
  "/skills": "技能库",
  "/settings": "设置",
};

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const settingsStore = useSettingsStore();
  const novelStore = useNovelStore();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isDark = settingsStore.theme === "dark";

  // Initialize stores on mount.
  // NOTE: 用 getState() 拿稳定的 action 引用，依赖置空 —— 不要把整个 store 对象放进依赖，
  // 否则每次 set() 产生新引用会让 effect 无限重跑（Maximum update depth exceeded）。
  useEffect(() => {
    useSettingsStore.getState().loadSettings();
    if (useNovelStore.getState().novels.length === 0) {
      useNovelStore
        .getState()
        .fetchNovels()
        .catch(() => {});
    }
  }, []);

  // Load AI providers on mount
  useEffect(() => {
    useAiStore.getState().loadProviders();
    useSkillStore
      .getState()
      .listSkills()
      .catch(() => {});
  }, []);

  // Responsive check
  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth <= 768);
      if (window.innerWidth > 768) setMobileOpen(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Cmd+K shortcut
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      setSearchQuery("");
      setActiveIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  const currentPath = location.pathname;
  const currentPageTitle = PAGE_TITLES[currentPath] || "";

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: SearchResult[] = [];

    // Nav items
    for (const n of NAV_ITEMS) {
      if (n.label.toLowerCase().includes(q)) {
        results.push({
          id: `nav-${n.key}`,
          title: n.label,
          meta: "页面跳转",
          group: "nav",
          action: "navigate",
          path: n.key,
        });
      }
    }

    // Novels
    for (const n of novelStore.novels) {
      const hay = `${n.title} ${n.author} ${n.genre} ${n.description}`.toLowerCase();
      if (hay.includes(q)) {
        results.push({
          id: `novel-${n.id}`,
          title: n.title,
          meta: [n.author, n.genre].filter(Boolean).join(" · ") || "未分类",
          group: "novel",
          action: "open-novel",
          novelId: n.id,
        });
      }
    }

    // Chapters (current novel only)
    const cur = novelStore.currentNovel;
    if (cur) {
      for (const c of cur.chapters) {
        if (c.title.toLowerCase().includes(q)) {
          results.push({
            id: `chapter-${c.id}`,
            title: c.title,
            meta: `《${cur.title}》章节`,
            group: "chapter",
            action: "open-chapter",
            novelId: cur.id,
            chapterId: c.id,
          });
        }
      }
    }

    return results;
  }, [searchQuery, novelStore.novels, novelStore.currentNovel]);

  const groupedResults = useMemo(() => {
    const groups: { label: string; icon: React.ReactNode; items: SearchResult[] }[] = [];
    for (const key of Object.keys(GROUP_META) as SearchGroup[]) {
      const items = searchResults.filter((r) => r.group === key);
      if (items.length > 0) {
        groups.push({ label: GROUP_META[key].label, icon: GROUP_META[key].icon, items });
      }
    }
    return groups;
  }, [searchResults]);

  const goToResult = useCallback(
    async (result: SearchResult) => {
      setSearchOpen(false);
      setSearchQuery("");
      setActiveIndex(0);

      if (result.action === "navigate" && result.path) {
        navigate(result.path);
      } else if (result.action === "open-novel" && result.novelId) {
        await novelStore.openNovel(result.novelId);
        navigate(`/editor/${result.novelId}`);
      } else if (result.action === "open-chapter" && result.novelId && result.chapterId) {
        if (novelStore.currentNovel?.id !== result.novelId) {
          await novelStore.openNovel(result.novelId);
        }
        novelStore.setActiveChapter(result.chapterId);
        navigate(`/editor/${result.novelId}`);
      }
    },
    [navigate, novelStore],
  );

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
    if (isMobile) setMobileOpen(false);
  };

  // Determine active menu key
  const selectedKeys = useMemo(() => {
    if (currentPath.startsWith("/editor")) return [];
    const match = NAV_ITEMS.find((item) => currentPath.startsWith(item.key));
    return match ? [match.key] : ["/workbench"];
  }, [currentPath]);

  return (
    <div className="app-layout" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <Sider
        width={220}
        theme={isDark ? "dark" : "light"}
        className={`app-sidebar ${isMobile && mobileOpen ? "mobile-open" : ""}`}
        style={{
          height: "100%",
          borderRight: "1px solid var(--c-border, #f0f0f0)",
          position: isMobile ? "fixed" : "relative",
          zIndex: isMobile ? 200 : 100,
          ...(isMobile && !mobileOpen ? { transform: "translateX(-100%)" } : {}),
          transition: "transform 0.3s ease-out",
        }}
      >
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 12,
            borderBottom: "1px solid var(--c-border, #f0f0f0)",
          }}
        >
          <EditOutlined style={{ fontSize: 24, color: "var(--c-primary-500, #1677ff)" }} />
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--c-text-1, rgba(0,0,0,0.88))",
              fontFamily: "var(--font-serif)",
            }}
          >
            Ink Scholar
          </span>
        </div>

        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          items={NAV_ITEMS}
          onClick={handleMenuClick}
          style={{ border: "none", background: "transparent", padding: "16px 12px" }}
        />
      </Sider>

      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        // biome-ignore lint/a11y/useSemanticElements: accessible custom button; role=button + keyboard handler is the correct pattern here
        <div
          role="button"
          tabIndex={0}
          aria-label="关闭菜单"
          onClick={() => setMobileOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setMobileOpen(false);
          }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,19,24,0.45)", zIndex: 90 }}
        />
      )}

      {/* Main content */}
      <Layout style={{ flex: 1, minWidth: 0 }}>
        <Header
          style={{
            height: 56,
            padding: "0 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--c-surface, #fff)",
            borderBottom: "1px solid var(--c-border, #f0f0f0)",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button
              type="text"
              icon={<MenuOutlined />}
              style={{ display: isMobile ? "inline-flex" : "none" }}
              onClick={() => setMobileOpen(!mobileOpen)}
            />
            <Breadcrumb
              items={[
                { title: <Link to="/workbench">首页</Link> },
                ...(currentPageTitle && currentPath !== "/workbench"
                  ? [{ title: currentPageTitle }]
                  : []),
              ]}
            />
          </div>
          <Button type="text" icon={<SearchOutlined />} onClick={() => setSearchOpen(true)}>
            <span
              style={{
                fontSize: 12,
                color: "var(--c-text-4, #bfbfbf)",
                background: "var(--c-surface-2, #fafafa)",
                padding: "2px 6px",
                borderRadius: 4,
                fontFamily: "monospace",
              }}
            >
              ⌘K
            </span>
          </Button>
        </Header>

        <Content style={{ flex: 1, overflow: "auto" }}>
          <Suspense
            fallback={
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                }}
              >
                加载中...
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </Content>
      </Layout>

      {/* Search modal */}
      <Modal
        open={searchOpen}
        onCancel={() => setSearchOpen(false)}
        footer={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              fontSize: 12,
              color: "var(--c-text-4)",
            }}
          >
            <span>
              <kbd style={kbdStyle}>↑</kbd>
              <kbd style={kbdStyle}>↓</kbd> 选择
            </span>
            <span>
              <kbd style={kbdStyle}>↵</kbd> 打开
            </span>
            <span>
              <kbd style={kbdStyle}>esc</kbd> 关闭
            </span>
          </div>
        }
        closable={false}
        styles={{ body: { padding: 0 }, wrapper: { borderRadius: 12 } }}
        width={600}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--c-border, #f0f0f0)",
            gap: 12,
          }}
        >
          <SearchOutlined style={{ color: "var(--c-text-4)" }} />
          <input
            ref={searchInputRef as React.RefObject<HTMLInputElement>}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((prev) =>
                  searchResults.length > 0 ? (prev + 1) % searchResults.length : 0,
                );
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((prev) =>
                  searchResults.length > 0
                    ? (prev - 1 + searchResults.length) % searchResults.length
                    : 0,
                );
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const r = searchResults[activeIndex];
                if (r) goToResult(r);
              }
            }}
            placeholder="搜索作品、章节、设置..."
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 16,
              background: "transparent",
            }}
          />
        </div>

        <div style={{ maxHeight: 400, overflowY: "auto", padding: 8 }}>
          {searchResults.length > 0 ? (
            groupedResults.map((group) => (
              <div key={group.label} style={{ padding: "4px 8px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "8px 12px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--c-text-4)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {group.icon} <span>{group.label}</span>
                </div>
                {group.items.map((result) => {
                  const isActive = searchResults.indexOf(result) === activeIndex;
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: accessible custom button; role=button + keyboard handler is the correct pattern here
                    <div
                      key={result.id}
                      role="button"
                      tabIndex={0}
                      onMouseEnter={() => setActiveIndex(searchResults.indexOf(result))}
                      onClick={() => goToResult(result)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") goToResult(result);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "12px 16px",
                        gap: 12,
                        borderRadius: 8,
                        cursor: "pointer",
                        transition: "all 0.15s",
                        background: isActive ? "var(--c-accent-50, #e6f4ff)" : "transparent",
                        color: isActive ? "var(--c-accent-700, #1677ff)" : undefined,
                        boxShadow: isActive
                          ? "inset 2px 0 0 var(--c-accent-500, #1677ff)"
                          : undefined,
                      }}
                    >
                      <span style={{ flex: 1, fontSize: 14 }}>{result.title}</span>
                      <span style={{ fontSize: 12, color: "var(--c-text-4)" }}>{result.meta}</span>
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <div
              style={{ padding: 32, textAlign: "center", color: "var(--c-text-4)", fontSize: 14 }}
            >
              {searchQuery ? "未找到匹配结果" : "输入关键词搜索你的作品与章节"}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 18,
  height: 18,
  marginRight: 3,
  padding: "0 4px",
  border: "1px solid var(--c-border-strong)",
  borderBottomWidth: 2,
  borderRadius: 4,
  background: "var(--c-surface-2)",
  color: "var(--c-text-3)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  lineHeight: 1,
};
