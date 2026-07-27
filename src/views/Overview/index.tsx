import {
  BookOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { Input as AntInput, Empty, Form, Modal, message, Select } from "antd";
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  formatRelativeTime,
  formatWordCount,
  GENRES,
  getCoverGradient,
  getGenreIcon,
  NovelCard,
  Segmented,
  StatCard,
  toast,
} from "@/components/ui";
import { useNovelStore } from "@/stores/useNovelStore";
import type { NovelMetadata } from "@/types";

// Error boundary
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Overview Error]", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto 24px",
            padding: 24,
            background: "var(--c-error-bg)",
            border: "1px solid var(--c-error)",
            borderRadius: 16,
            color: "var(--c-error)",
          }}
        >
          <h3 style={{ fontSize: 20, marginBottom: 12 }}>页面渲染出错</h3>
          <pre
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              whiteSpace: "pre-wrap",
              padding: 12,
              background: "rgb(0 0 0 / 5%)",
              borderRadius: 10,
              marginBottom: 12,
            }}
          >
            {this.state.error.message}
          </pre>
          <p style={{ fontSize: 14, opacity: 0.9 }}>
            请打开控制台查看详细错误信息，或刷新页面重试。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 创作目标字数（用于进度条基线）。 */
const GOAL = 200000;

type FilterKey = "全部" | "进行中" | "已完结" | "草稿";

const FILTERS: { label: string; value: FilterKey }[] = [
  { label: "全部", value: "全部" },
  { label: "进行中", value: "进行中" },
  { label: "已完结", value: "已完结" },
  { label: "草稿", value: "草稿" },
];

function deriveStatus(n: NovelMetadata): FilterKey {
  if (n.chapterCount === 0 || n.totalWordCount < 500) return "草稿";
  if (n.totalWordCount >= 100000) return "已完结";
  return "进行中";
}

function OverviewContent() {
  const navigate = useNavigate();
  const novels = useNovelStore((s) => s.novels);
  const fetchNovels = useNovelStore((s) => s.fetchNovels);
  const createNovel = useNovelStore((s) => s.createNovel);
  const openNovel = useNovelStore((s) => s.openNovel);

  const [showCreate, setShowCreate] = useState(false);
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);

  const [filter, setFilter] = useState<FilterKey>("全部");

  useEffect(() => {
    fetchNovels();
  }, [fetchNovels]);

  const sorted = useMemo(
    () =>
      [...novels].sort(
        (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime(),
      ),
    [novels],
  );

  const totalWords = useMemo(() => novels.reduce((a, n) => a + n.totalWordCount, 0), [novels]);
  const totalChapters = useMemo(() => novels.reduce((a, n) => a + n.chapterCount, 0), [novels]);
  const lastActive = sorted.length > 0 ? formatRelativeTime(sorted[0].updatedAt) : "—";

  const continueNovel = sorted[0] ?? null;
  const continuePct = continueNovel ? Math.min(1, continueNovel.totalWordCount / GOAL) : 0;

  const filtered = useMemo(() => {
    if (filter === "全部") return sorted;
    return sorted.filter((n) => deriveStatus(n) === filter);
  }, [sorted, filter]);

  const canCreate = Form.useWatch((values) => values.title && values.author && values.genre, form);

  const handleOpen = (id: string) => {
    openNovel(id)
      .catch(() => {})
      .finally(() => navigate(`/editor/${id}`));
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const novel = await createNovel(
        values.title,
        values.author,
        values.genre,
        values.description || "",
      );
      setShowCreate(false);
      form.resetFields();
      message.success("故事创建成功，开始创作吧！");
      navigate(`/editor/${novel.id}`);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "errorFields" in err) return; // 表单校验错误
      message.error("创建失败，请重试");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ui-page">
      <div className="ui-page__inner">
        {/* 欢迎头部 */}
        <section className="ui-hero fade-in">
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -40,
              right: -40,
              width: 180,
              height: 180,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.12)",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              bottom: -20,
              right: 80,
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.1)",
            }}
          />
          <div className="ui-hero__title">下午好，创作者 👋</div>
          <div className="ui-hero__sub">用文字构建世界，让 AI 成为你的创作伙伴</div>
          <Button
            variant="secondary"
            size="lg"
            icon={<PlusOutlined />}
            onClick={() => setShowCreate(true)}
          >
            新建作品
          </Button>
        </section>

        {/* 统计卡 */}
        <section className="ui-stats" style={{ marginTop: 24 }}>
          <StatCard
            tone="blue"
            icon={<FileTextOutlined />}
            value={formatWordCount(totalWords)}
            label="总字数"
          />
          <StatCard tone="teal" icon={<BookOutlined />} value={novels.length} label="作品总数" />
          <StatCard tone="green" icon={<ReadOutlined />} value={totalChapters} label="章节总数" />
          <StatCard
            tone="amber"
            icon={<ClockCircleOutlined />}
            value={lastActive}
            label="最近活跃"
          />
        </section>

        {/* 双栏：继续创作 + 创作动态 */}
        <section className="ui-cols" style={{ marginTop: 24 }}>
          <Card hover>
            <CardHeader
              title="继续创作"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => continueNovel && handleOpen(continueNovel.id)}
                >
                  进入编辑器 →
                </Button>
              }
            />
            <CardBody>
              {continueNovel ? (
                <div className="ui-continue">
                  <div
                    className="ui-continue__cover"
                    style={{ background: getCoverGradient(continueNovel.genre) }}
                  >
                    {getGenreIcon(continueNovel.genre)}
                  </div>
                  <div className="ui-continue__meta">
                    <div className="ui-continue__title">{continueNovel.title}</div>
                    <div className="ui-continue__genre">
                      {continueNovel.genre} · {continueNovel.chapterCount} 章
                    </div>
                    <div className="ui-progress">
                      <i style={{ width: `${continuePct * 100}%` }} />
                    </div>
                    <div className="ui-progress-row">
                      <span>
                        已写 {formatWordCount(continueNovel.totalWordCount)} 字 / 目标 20 万字
                      </span>
                      <b style={{ color: "var(--c-primary-700)" }}>
                        {Math.round(continuePct * 100)}%
                      </b>
                    </div>
                    <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button onClick={() => handleOpen(continueNovel.id)}>继续写作</Button>
                      <Button variant="secondary" onClick={() => toast("已生成续写建议（演示）")}>
                        AI 续写建议
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <Empty description="还没有作品，点击右上角开始创作" />
              )}
            </CardBody>
          </Card>

          <Card hover>
            <CardHeader
              title="创作动态"
              action={
                <Button variant="ghost" size="sm">
                  全部
                </Button>
              }
            />
            <CardBody>
              {sorted.length > 0 ? (
                <div className="ui-feed">
                  {sorted.slice(0, 5).map((n, i) => (
                    <div className="ui-feed__item" key={n.id}>
                      <span
                        className={`ui-feed__dot ${["is-blue", "is-teal", "is-amber"][i % 3]}`}
                      />
                      <div>
                        <div className="ui-feed__text">
                          <b>{n.title}</b> 更新了 {n.chapterCount} 章 ·{" "}
                          {formatWordCount(n.totalWordCount)} 字
                        </div>
                        <div className="ui-feed__time">{formatRelativeTime(n.updatedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="暂无创作动态" />
              )}
            </CardBody>
          </Card>
        </section>

        {/* 我的作品 */}
        <section className="ui-section">
          <div className="ui-section__head">
            <h2 className="ui-section__title">我的作品</h2>
            <Segmented options={FILTERS} value={filter} onChange={setFilter} />
          </div>
          {filtered.length > 0 ? (
            <div className="ui-novels">
              {filtered.map((n) => (
                <NovelCard
                  key={n.id}
                  novel={n}
                  progress={n.totalWordCount / GOAL}
                  onClick={() => handleOpen(n.id)}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "48px 32px",
                background: "var(--c-surface)",
                borderRadius: 16,
                border: "1px solid var(--c-border)",
              }}
            >
              <Empty description={filter === "全部" ? "还没有作品" : `暂无「${filter}」作品`} />
            </div>
          )}
        </section>
      </div>

      {/* 新建作品弹窗 */}
      <Modal
        title="创建新故事"
        open={showCreate}
        onCancel={() => {
          setShowCreate(false);
          form.resetFields();
        }}
        onOk={handleCreate}
        confirmLoading={creating}
        okButtonProps={{ disabled: !canCreate, icon: <CheckOutlined /> }}
        okText="开始创作"
        cancelText="取消"
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="故事标题"
            name="title"
            rules={[{ required: true, message: "请输入标题" }]}
          >
            <AntInput placeholder="给你的故事起个名字" maxLength={50} showCount />
          </Form.Item>
          <Form.Item label="作者" name="author" rules={[{ required: true, message: "请输入作者" }]}>
            <AntInput placeholder="你的笔名" />
          </Form.Item>
          <Form.Item label="类型" name="genre" rules={[{ required: true, message: "请选择类型" }]}>
            <Select placeholder="选择故事类型">
              {GENRES.map((g) => (
                <Select.Option key={g.value} value={g.value}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      marginRight: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--c-primary-700)",
                      background: "var(--c-primary-50)",
                      borderRadius: 6,
                    }}
                  >
                    {g.icon}
                  </span>
                  {g.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="简介" name="description">
            <AntInput.TextArea
              rows={3}
              placeholder="简要描述你的故事背景和主线（可选）"
              maxLength={200}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default function Overview() {
  return (
    <ErrorBoundary>
      <OverviewContent />
    </ErrorBoundary>
  );
}
