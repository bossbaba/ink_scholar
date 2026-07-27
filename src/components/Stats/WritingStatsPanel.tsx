import {
  BookOutlined,
  EditOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { message, Radio, Select } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNovelStore } from "@/stores/useNovelStore";
import type { WritingDailyStat } from "@/types";

function formatWordCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`;
  return count.toString();
}

function utcDate(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export default function WritingStatsPanel() {
  const novelStore = useNovelStore();
  const novels = useNovelStore((s) => s.novels);
  const [scope, setScope] = useState<string>("all");
  const [range, setRange] = useState(90);
  const [stats, setStats] = useState<WritingDailyStat[]>([]);

  const novelOptions = useMemo(
    () => novels.map((n) => ({ value: n.id, label: n.title })),
    [novels],
  );

  const scopeLabel =
    scope === "all" ? "全部作品" : novels.find((n) => n.id === scope)?.title || "作品";

  const reload = async () => {
    try {
      if (!novels.length) await novelStore.fetchNovels();
      const result = await novelStore.getWritingStats(scope === "all" ? undefined : scope);
      setStats(result);
    } catch {
      message.error("加载写作统计失败");
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload on scope/range change; reload is recreated every render, so depending on it would cause a re-render loop
  useEffect(() => {
    reload();
  }, [scope, range]);

  const activeDates = useMemo(() => new Set(stats.map((s) => s.statDate)), [stats]);

  const series = useMemo(() => {
    const dates: string[] = [];
    for (let i = range - 1; i >= 0; i--) dates.push(utcDate(i));
    const map = new Map(stats.map((s) => [s.statDate, s.totalWords]));
    return dates.map((d) => ({ date: d, words: map.get(d) || 0 }));
  }, [stats, range]);

  const maxWords = useMemo(() => series.reduce((m, p) => Math.max(m, p.words), 0), [series]);
  const headlineWords = series.length ? series[series.length - 1].words : 0;
  const headlineNovels = novels.length;
  const headlineChapters = novels.reduce((s, n) => s + (n.chapterCount || 0), 0);

  const streak = useMemo(() => {
    let offset = 0;
    if (!activeDates.has(utcDate(0))) {
      if (!activeDates.has(utcDate(1))) return 0;
      offset = 1;
    }
    let count = 0;
    let d = offset;
    while (activeDates.has(utcDate(d))) {
      count++;
      d++;
    }
    return count;
  }, [activeDates]);

  // SVG chart
  const chartW = 720,
    chartH = 220,
    padL = 10,
    padR = 10,
    padT = 16,
    padB = 24;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const points = useMemo(() => {
    const n = series.length;
    if (!n) return [];
    const max = maxWords || 1;
    return series.map((p, i) => ({
      x: padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
      y: padT + innerH * (1 - p.words / max),
    }));
  }, [series, maxWords, innerW, innerH]);

  const linePath = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const areaPath = points.length
    ? `M ${points[0].x} ${padT + innerH} ` +
      points.map((p) => `L ${p.x} ${p.y}`).join(" ") +
      ` L ${points[points.length - 1].x} ${padT + innerH} Z`
    : "";
  const lastPoint = points[points.length - 1] || null;

  // Per-novel bars
  const perNovel = useMemo(() => {
    const list = novels
      .map((n) => ({ id: n.id, title: n.title, words: n.totalWordCount }))
      .sort((a, b) => b.words - a.words);
    const max = Math.max(1, ...list.map((l) => l.words));
    return list.map((l) => ({ ...l, pct: Math.round((l.words / max) * 100) }));
  }, [novels]);

  // Heatmap (70 days)
  const heatDays = useMemo(() => {
    const arr: { date: string; active: boolean }[] = [];
    for (let i = 69; i >= 0; i--)
      arr.push({ date: utcDate(i), active: activeDates.has(utcDate(i)) });
    return arr;
  }, [activeDates]);

  return (
    <section style={{ marginBottom: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 600,
            fontFamily: "var(--font-serif)",
            color: "var(--c-text-1)",
          }}
        >
          写作统计
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Select
            value={scope}
            onChange={setScope}
            size="small"
            style={{ width: 160 }}
            options={[{ value: "all", label: "全部作品" }, ...novelOptions]}
          />
          <Radio.Group value={range} onChange={(e) => setRange(e.target.value)} size="small">
            <Radio.Button value={30}>30天</Radio.Button>
            <Radio.Button value={90}>90天</Radio.Button>
            <Radio.Button value={180}>半年</Radio.Button>
          </Radio.Group>
        </div>
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
          marginBottom: 24,
        }}
      >
        <StatCard
          icon={<EditOutlined />}
          iconBg="linear-gradient(135deg, #52c41a, #5fd4a9)"
          value={formatWordCount(headlineWords)}
          label="累计总字数"
        />
        <StatCard
          icon={<BookOutlined />}
          iconBg="linear-gradient(135deg, var(--c-primary-500), var(--c-primary-300))"
          value={String(headlineNovels)}
          label="部作品"
        />
        <StatCard
          icon={<FileTextOutlined />}
          iconBg="linear-gradient(135deg, var(--c-accent-500), var(--c-accent-300))"
          value={String(headlineChapters)}
          label="个章节"
        />
        <StatCard
          icon={<ThunderboltOutlined />}
          iconBg="linear-gradient(135deg, #f6a23c, #f6c45c)"
          value={String(streak)}
          label="连续写作天数"
        />
      </div>

      {/* Trend chart */}
      <div
        style={{
          background: "var(--c-surface)",
          borderRadius: 16,
          border: "1px solid var(--c-border)",
          padding: 24,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 20,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--c-text-1)",
          }}
        >
          <span>总字数趋势</span>
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--c-text-4)" }}>
            {scopeLabel} · 近 {range} 天
          </span>
        </div>
        {series.length && maxWords > 0 ? (
          <div>
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              preserveAspectRatio="none"
              style={{ width: "100%", height: 200, display: "block" }}
            >
              <title>写作趋势图</title>
              <path d={areaPath} style={{ fill: "var(--c-primary-500)", fillOpacity: 0.12 }} />
              <path
                d={linePath}
                style={{
                  fill: "none",
                  stroke: "var(--c-primary-500)",
                  strokeWidth: 2,
                  strokeLinejoin: "round",
                  strokeLinecap: "round",
                }}
              />
              {lastPoint && (
                <circle
                  cx={lastPoint.x}
                  cy={lastPoint.y}
                  r={3.5}
                  style={{
                    fill: "var(--c-primary-600)",
                    stroke: "var(--c-surface)",
                    strokeWidth: 2,
                  }}
                />
              )}
            </svg>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 12,
                color: "var(--c-text-4)",
                fontFamily: "var(--font-mono)",
              }}
            >
              <span>{series[0]?.date.slice(5)}</span>
              <span>{series[Math.floor(series.length / 2)]?.date.slice(5)}</span>
              <span>{series[series.length - 1]?.date.slice(5)}</span>
            </div>
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "40px 24px",
              color: "var(--c-text-4)",
              fontSize: 14,
            }}
          >
            暂无写作记录，保存后这里会显示你的字数成长曲线
          </div>
        )}
      </div>

      {/* Two columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Per-novel bars */}
        <div
          style={{
            background: "var(--c-surface)",
            borderRadius: 16,
            border: "1px solid var(--c-border)",
            padding: 24,
          }}
        >
          <div
            style={{ marginBottom: 20, fontSize: 14, fontWeight: 600, color: "var(--c-text-1)" }}
          >
            各作品字数
          </div>
          {perNovel.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {perNovel.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "96px 1fr 56px",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      color: "var(--c-text-2)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={b.title}
                  >
                    {b.title}
                  </span>
                  <div
                    style={{
                      height: 8,
                      background: "var(--c-surface-2)",
                      borderRadius: 99,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${b.pct}%`,
                        background:
                          "linear-gradient(90deg, var(--c-primary-500), var(--c-primary-300))",
                        borderRadius: 99,
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 14,
                      color: "var(--c-text-3)",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {formatWordCount(b.words)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "40px 24px",
                color: "var(--c-text-4)",
                fontSize: 14,
              }}
            >
              还没有作品
            </div>
          )}
        </div>

        {/* Heatmap */}
        <div
          style={{
            background: "var(--c-surface)",
            borderRadius: 16,
            border: "1px solid var(--c-border)",
            padding: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 20,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--c-text-1)",
            }}
          >
            <span>写作活跃</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--c-text-4)" }}>
              近 10 周
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(10, 1fr)",
              gap: 4,
              marginBottom: 16,
            }}
          >
            {heatDays.map((d, _i) => (
              <div
                key={d.date}
                title={d.date}
                style={{
                  aspectRatio: "1/1",
                  borderRadius: 3,
                  background: d.active ? "var(--c-primary-500)" : "var(--c-surface-2)",
                  border: `1px solid ${d.active ? "var(--c-primary-500)" : "var(--c-border)"}`,
                  transition: "background 0.14s",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: "var(--c-surface-2)",
                border: "1px solid var(--c-border)",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: "var(--c-primary-500)",
                border: "1px solid var(--c-primary-500)",
              }}
            />
            <span style={{ fontSize: 12, color: "var(--c-text-4)", marginLeft: 8 }}>
              越亮表示当天有保存
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({
  icon,
  iconBg,
  value,
  label,
}: {
  icon: React.ReactNode;
  iconBg: string;
  value: string;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: 24,
        background: "var(--c-surface)",
        borderRadius: 16,
        border: "1px solid var(--c-border)",
        transition: "all 0.22s",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 22,
          background: iconBg,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: "var(--c-text-1)", lineHeight: 1.2 }}>
          {value}
        </span>
        <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>{label}</span>
      </div>
    </div>
  );
}
