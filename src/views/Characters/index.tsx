import { NodeIndexOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Tag } from "antd";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { formatRelativeTime, formatWordCount, getGenreIcon } from "@/components/ui";
import { useNovelStore } from "@/stores/useNovelStore";

export default function Characters() {
  const navigate = useNavigate();
  const novels = useNovelStore((s) => s.novels);
  const fetchNovels = useNovelStore((s) => s.fetchNovels);

  useEffect(() => {
    fetchNovels();
  }, [fetchNovels]);

  return (
    <div className="ui-page">
      <div className="ui-page__inner">
        <header className="page-head">
          <div>
            <p className="page-eyebrow">角色关系</p>
            <h1 className="page-title">选择作品</h1>
            <p className="page-subtitle">选择一部作品，管理其中的人物关系</p>
          </div>
          <div className="page-head__actions">
            <span
              style={{ fontSize: 14, color: "var(--c-text-3)", fontFamily: "var(--font-mono)" }}
            >
              {novels.length} 部作品
            </span>
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
                onClick={() => navigate(`/characters/${novel.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") navigate(`/characters/${novel.id}`);
                }}
              >
                <div
                  className="cover-card__cover"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--c-primary-500), var(--c-primary-700))",
                  }}
                >
                  <span className="cover-card__cover-text">{getGenreIcon(novel.genre)}</span>
                  {/* 蒙层由 .cover-card:hover 触发显隐（CSS），修复原先 JS onMouseEnter 永不生效的问题 */}
                  <div className="cover-card__overlay">
                    <Button
                      type="primary"
                      shape="round"
                      icon={<NodeIndexOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/characters/${novel.id}`);
                      }}
                    >
                      管理角色关系 →
                    </Button>
                  </div>
                </div>
                <div className="cover-card__body">
                  <h3 className="cover-card__title">{novel.title}</h3>
                  <p className="cover-card__author">{novel.author}</p>
                  <div className="cover-card__footer">
                    <div className="cover-card__meta">
                      <Tag>{novel.genre}</Tag>
                      <span>{formatWordCount(novel.totalWordCount)}字</span>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--c-text-4)" }}>
                      {formatRelativeTime(novel.updatedAt)}
                    </span>
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
                      fontFamily: "var(--font-serif)",
                      fontSize: 24,
                      fontWeight: 600,
                      color: "var(--c-text-2)",
                      marginBottom: 12,
                    }}
                  >
                    还没有作品
                  </h3>
                  <p style={{ fontSize: 16, color: "var(--c-text-4)", marginBottom: 24 }}>
                    先在「我的作品」中创建一部小说，再来编织人物关系
                  </p>
                </>
              }
            />
            <Button
              type="primary"
              shape="round"
              icon={<PlusOutlined />}
              onClick={() => navigate("/library")}
            >
              去我的作品创建
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
