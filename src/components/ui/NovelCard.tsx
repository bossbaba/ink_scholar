import type { NovelMetadata } from "@/types";
import { getCoverGradient } from "./cover";
import { formatWordCount } from "./format";

interface NovelCardProps {
  novel: NovelMetadata;
  /** 进度 0~1 */
  progress?: number;
  onClick?: () => void;
}

export function NovelCard({ novel, progress = 0, onClick }: NovelCardProps) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <button type="button" className="ui-novel" onClick={onClick}>
      <div className="ui-novel__thumb" style={{ background: getCoverGradient(novel.genre) }}>
        <span className="ui-novel__tag">{novel.genre || "未分类"}</span>
      </div>
      <div className="ui-novel__info">
        <div className="ui-novel__title">{novel.title}</div>
        <div className="ui-novel__meta">
          <span>{novel.author}</span>
          <span>·</span>
          <span>{novel.chapterCount} 章</span>
          <span>·</span>
          <span>{formatWordCount(novel.totalWordCount)} 字</span>
        </div>
        <div className="ui-novel__bar">
          <i style={{ width: `${pct * 100}%` }} />
        </div>
      </div>
    </button>
  );
}
