import { BookOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, message, Popconfirm, Tag } from "antd";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { formatRelativeTime, formatWordCount, getCoverGradient } from "@/components/ui";
import { useNovelStore } from "@/stores/useNovelStore";

export default function Library() {
  const navigate = useNavigate();
  const novels = useNovelStore((s) => s.novels);
  const fetchNovels = useNovelStore((s) => s.fetchNovels);
  const deleteNovel = useNovelStore((s) => s.deleteNovel);

  useEffect(() => {
    fetchNovels();
  }, [fetchNovels]);

  const handleDelete = async (novelId: string) => {
    try {
      await deleteNovel(novelId);
      message.success("已删除");
    } catch {
      message.error("删除失败");
    }
  };

  return (
    <div className="ui-page">
      <div className="ui-page__inner">
        <header className="page-head">
          <div>
            <p className="page-eyebrow">我的作品</p>
            <h1 className="page-title">作品库</h1>
            <p className="page-subtitle">管理你的所有小说作品</p>
          </div>
          <div className="page-head__actions">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/workbench")}>
              创建新故事
            </Button>
          </div>
        </header>

        {novels.length > 0 ? (
          <div className="ui-novels">
            {novels.map((novel, index) => (
              // biome-ignore lint/a11y/useSemanticElements: card wraps nested action buttons, so a real <button> is invalid; role=button + keyboard handler is the correct accessible pattern
              <div
                key={novel.id}
                className="cover-card fade-in"
                role="button"
                tabIndex={0}
                style={{ animationDelay: `${index * 0.05}s` }}
                onClick={() => navigate(`/editor/${novel.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") navigate(`/editor/${novel.id}`);
                }}
              >
                <div
                  className="cover-card__cover"
                  style={{ background: getCoverGradient(novel.genre) }}
                >
                  <BookOutlined className="cover-card__cover-icon" />
                </div>
                <div className="cover-card__body">
                  <h3 className="cover-card__title">{novel.title}</h3>
                  <p className="cover-card__author">{novel.author}</p>
                  {novel.description && <p className="cover-card__desc">{novel.description}</p>}
                  <div className="cover-card__footer">
                    <div className="cover-card__meta">
                      {novel.genre && <Tag color="blue">{novel.genre}</Tag>}
                      <span>
                        {novel.chapterCount}章 · {formatWordCount(novel.totalWordCount)}字
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--c-text-4)" }}>
                      {formatRelativeTime(novel.updatedAt)}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/editor/${novel.id}`);
                      }}
                    />
                    <Popconfirm
                      title="确定删除这部作品吗？"
                      description="删除后无法恢复"
                      onConfirm={() => handleDelete(novel.id)}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-box">
            <Empty
              description={
                <>
                  <h3
                    style={{
                      fontSize: 20,
                      fontWeight: 500,
                      color: "var(--c-text-2)",
                      marginBottom: 8,
                    }}
                  >
                    还没有作品
                  </h3>
                  <p style={{ color: "var(--c-text-4)" }}>点击上方按钮创建你的第一部小说</p>
                </>
              }
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/workbench")}>
              创建新故事
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
