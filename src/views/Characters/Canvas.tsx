import {
  ApiOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  MoonOutlined,
  PlusOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Form, Input, Modal, message, Popconfirm, Select, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useNovelStore } from "@/stores/useNovelStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { Character, CharacterRelation } from "@/types";
import { CHARACTER_PALETTE, RELATION_CATEGORIES } from "@/types";

const LABEL_SUGGEST = [
  "父子",
  "母子",
  "师徒",
  "恋人",
  "夫妻",
  "兄弟",
  "姐妹",
  "敌对",
  "盟友",
  "主仆",
  "君臣",
];
const CX = 500,
  CY = 330,
  RING_R = 230;

export default function CharacterCanvas() {
  const { novelId = "" } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const novelStore = useNovelStore();
  const settingsStore = useSettingsStore();

  const [novelTitle, setNovelTitle] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [relations, setRelations] = useState<CharacterRelation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showStrip, setShowStrip] = useState(true);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savingRel, setSavingRel] = useState(false);

  // Dialogs
  const [charDialogOpen, setCharDialogOpen] = useState(false);
  const [charForm, setCharForm] = useState<{
    id?: string;
    name: string;
    identity: string;
    description: string;
    color: string;
  }>({ name: "", identity: "", description: "", color: CHARACTER_PALETTE[0] });
  const [relDialogOpen, setRelDialogOpen] = useState(false);
  const [relForm, setRelForm] = useState<{
    fromId: string;
    toId: string;
    category: string;
    label: string;
    description: string;
  }>({ fromId: "", toId: "", category: "blood", label: "", description: "" });

  const isDark = useSettingsStore((s) => s.theme === "dark");

  // Layout
  const layout = useCallback(() => {
    const proto = characters.find((c) => c.identity === "主角");
    const others = proto ? characters.filter((c) => c.id !== proto.id) : characters;
    const pos: Record<string, { x: number; y: number }> = {};
    if (proto) pos[proto.id] = { x: CX, y: CY };
    others.forEach((c, i) => {
      if (others.length <= 1) {
        pos[c.id] = { x: CX, y: CY + (proto ? RING_R : 0) };
      } else {
        const ang = (i / others.length) * Math.PI * 2 - Math.PI / 2;
        pos[c.id] = { x: CX + RING_R * Math.cos(ang), y: CY + RING_R * Math.sin(ang) };
      }
    });
    setNodePositions(pos);
  }, [characters]);

  // Load data
  const reload = useCallback(async () => {
    if (!novelId) {
      setLoadError("缺少作品 ID");
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      // 用 getState() 取稳定 action + 读最新 novels；不要依赖整个 store 对象，
      // 否则每次 set() 都会让 reload 重建，进而使 [reload] 的 effect 无限重跑（Maximum update depth exceeded）
      await useNovelStore.getState().fetchNovels();
      const nv = useNovelStore.getState().novels.find((n) => n.id === novelId);
      setNovelTitle(nv ? nv.title : "未命名作品");
      const chars = await useNovelStore.getState().listCharacters(novelId);
      const rels = await useNovelStore.getState().listCharacterRelations(novelId);
      setCharacters(chars);
      setRelations(rels);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      message.error(`加载角色关系失败：${msg}`);
    } finally {
      setIsLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    layout();
  }, [layout]);

  // Selection
  const selectedCharacter = characters.find((c) => c.id === selectedId) || null;
  const selectedRelations = relations.filter(
    (r) => r.fromId === selectedId || r.toId === selectedId,
  );
  const drawerOpen = selectedId !== null;

  // Highlight/dim
  const isNodeDimmed = (id: string) => {
    if (!selectedId || id === selectedId) return false;
    return !relations.some(
      (r) =>
        (r.fromId === selectedId && r.toId === id) || (r.toId === selectedId && r.fromId === id),
    );
  };
  const isEdgeActive = (rel: CharacterRelation) =>
    !!selectedId && (rel.fromId === selectedId || rel.toId === selectedId);
  const isEdgeDimmed = (rel: CharacterRelation) => !!selectedId && !isEdgeActive(rel);

  // Edge geometry
  const edgeList = useMemo(() => {
    const out: (CharacterRelation & {
      geom: { x1: number; y1: number; x2: number; y2: number; mx: number; my: number };
      labelW: number;
      displayLabel: string;
    })[] = [];
    for (const rel of relations) {
      const a = nodePositions[rel.fromId];
      const b = nodePositions[rel.toId];
      if (!(a && b)) continue;
      const r = 30;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist,
        uy = dy / dist;
      const x1 = a.x + ux * r,
        y1 = a.y + uy * r;
      const x2 = b.x - ux * (r + 10),
        y2 = b.y - uy * (r + 10);
      const label = rel.label || RELATION_CATEGORIES[rel.category]?.label || "";
      out.push({
        ...rel,
        geom: { x1, y1, x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 },
        labelW: label.length * 13 + 24,
        displayLabel: label,
      });
    }
    return out;
  }, [relations, nodePositions]);

  const nodePos = (id: string) => nodePositions[id] || { x: 0, y: 0 };
  const initial = (name: string) => (name ? name.charAt(0) : "?");
  const charName = (id: string) => characters.find((c) => c.id === id)?.name || "未知";
  const canAddRelation = characters.length >= 2;
  const canSubmitRel =
    !!relForm.fromId && !!relForm.toId && !!relForm.category && relForm.fromId !== relForm.toId;

  const relationCategoriesPresent = useMemo(() => {
    const set = new Set(relations.map((r) => r.category));
    return Array.from(set);
  }, [relations]);

  // Character CRUD
  const openCreateChar = () => {
    setCharForm({ name: "", identity: "", description: "", color: CHARACTER_PALETTE[0] });
    setCharDialogOpen(true);
  };
  const openEditChar = (c: Character) => {
    setCharForm({
      id: c.id,
      name: c.name,
      identity: c.identity || "",
      description: c.description || "",
      color: c.color,
    });
    setCharDialogOpen(true);
  };

  const submitChar = async () => {
    const name = charForm.name.trim();
    if (!name) {
      message.warning("请填写角色名");
      return;
    }
    try {
      if (charForm.id) {
        await novelStore.updateCharacter(
          charForm.id,
          name,
          charForm.identity || null,
          charForm.description || null,
          charForm.color,
        );
        setCharacters((prev) =>
          prev.map((c) =>
            c.id === charForm.id
              ? {
                  ...c,
                  name,
                  identity: charForm.identity || undefined,
                  description: charForm.description || undefined,
                  color: charForm.color,
                }
              : c,
          ),
        );
        message.success("角色已更新");
      } else {
        const c = await novelStore.createCharacter(
          novelId,
          name,
          charForm.identity || null,
          charForm.description || null,
          charForm.color,
        );
        setCharacters((prev) => [...prev, c]);
        message.success("角色已创建");
      }
      setCharDialogOpen(false);
    } catch {
      message.error("保存失败，请重试");
    }
  };

  const deleteCharacter = async (c: Character) => {
    try {
      await novelStore.deleteCharacter(novelId, c.id);
      setCharacters((prev) => prev.filter((x) => x.id !== c.id));
      setRelations((prev) => prev.filter((r) => r.fromId !== c.id && r.toId !== c.id));
      if (selectedId === c.id) setSelectedId(null);
      message.success("角色已删除");
    } catch {
      message.error("删除失败，请重试");
    }
  };

  // Relation CRUD
  const openAddRel = (fromId?: string) => {
    setRelForm({
      fromId: fromId || selectedId || "",
      toId: "",
      category: "blood",
      label: "",
      description: "",
    });
    setRelDialogOpen(true);
  };

  const submitRel = async () => {
    if (!canSubmitRel || savingRel) return;
    setSavingRel(true);
    try {
      const rel = await novelStore.upsertCharacterRelation(
        novelId,
        relForm.fromId,
        relForm.toId,
        relForm.category,
        relForm.label || null,
        relForm.description || null,
      );
      setRelations((prev) => {
        const idx = prev.findIndex((r) => r.fromId === rel.fromId && r.toId === rel.toId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = rel;
          return copy;
        }
        return [...prev, rel];
      });
      message.success("关系已保存");
      setRelDialogOpen(false);
    } catch (e) {
      message.error(`保存失败：${e instanceof Error ? e.message : "请重试"}`);
    } finally {
      setSavingRel(false);
    }
  };

  const deleteRelation = async (rel: CharacterRelation) => {
    try {
      await novelStore.deleteCharacterRelation(novelId, rel.id);
      setRelations((prev) => prev.filter((r) => r.id !== rel.id));
      message.success("关系已删除");
    } catch {
      message.error("删除失败，请重试");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--c-bg)",
      }}
    >
      {/* Top bar */}
      <header className="cc-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/characters")}
          />
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              fontFamily: "var(--font-serif)",
              color: "var(--c-text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {novelTitle}
          </span>
          <span
            style={{
              fontSize: 14,
              color: "var(--c-text-4)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            · {characters.length} 位角色 · {relations.length} 条关系
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateChar}>
            新建角色
          </Button>
          <Button icon={<ApiOutlined />} disabled={!canAddRelation} onClick={() => openAddRel()}>
            添加关系
          </Button>
          <Tooltip title={isDark ? "切换浅色" : "切换深色"}>
            <Button
              icon={isDark ? <SunOutlined /> : <MoonOutlined />}
              onClick={() => settingsStore.setTheme(isDark ? "light" : "dark")}
            />
          </Tooltip>
        </div>
      </header>

      {/* Canvas area */}
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          background: "radial-gradient(circle at 50% 40%, var(--c-primary-50), var(--c-bg) 72%)",
        }}
      >
        <svg
          viewBox="0 0 1000 640"
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "calc(100% - 72px)", display: "block" }}
        >
          <title>角色关系图</title>
          <defs>
            {Object.entries(RELATION_CATEGORIES).map(([key, meta]) => (
              <marker
                key={key}
                id={`arrow-${key}`}
                viewBox="0 0 10 10"
                refX={8}
                refY={5}
                markerWidth={7}
                markerHeight={7}
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill={meta.color} />
              </marker>
            ))}
          </defs>

          {/* Edges */}
          {edgeList.map((edge) => (
            <g
              key={edge.id}
              style={{ opacity: isEdgeDimmed(edge) ? 0.22 : 1, transition: "opacity 0.14s" }}
            >
              <line
                x1={edge.geom.x1}
                y1={edge.geom.y1}
                x2={edge.geom.x2}
                y2={edge.geom.y2}
                stroke={RELATION_CATEGORIES[edge.category]?.color || "#9AA3B2"}
                strokeWidth={isEdgeActive(edge) ? 3 : 1.6}
                markerEnd={`url(#arrow-${edge.category})`}
              />
              <g transform={`translate(${edge.geom.mx}, ${edge.geom.my})`}>
                <rect
                  x={-edge.labelW / 2}
                  y={-13}
                  width={edge.labelW}
                  height={26}
                  rx={13}
                  style={{
                    fill: "var(--c-surface)",
                    opacity: 0.94,
                    stroke: "var(--c-border)",
                    strokeWidth: 1,
                  }}
                />
                <text
                  textAnchor="middle"
                  y={4}
                  style={{
                    fill: "var(--c-text-1)",
                    fontSize: 13,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {edge.displayLabel}
                </text>
              </g>
            </g>
          ))}

          {/* Nodes */}
          {characters.map((c) => {
            const pos = nodePos(c.id);
            const isProto = c.identity === "主角";
            const dimmed = isNodeDimmed(c.id);
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG node acts as a selectable button; role=button + keyboard handler is the correct accessible pattern
              <g
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelectedId(c.id);
                }}
                style={{
                  cursor: "pointer",
                  opacity: dimmed ? 0.26 : 1,
                  transition: "opacity 0.14s",
                }}
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isProto ? 32 : 24}
                  fill={c.color}
                  stroke={isProto ? "var(--c-accent-500)" : "rgba(255,255,255,0.7)"}
                  strokeWidth={isProto ? 3 : 1.5}
                />
                <text
                  x={pos.x}
                  y={pos.y + 5}
                  textAnchor="middle"
                  style={{
                    fill: "#fff",
                    fontFamily: "var(--font-serif)",
                    fontWeight: 700,
                    fontSize: 18,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {initial(c.name)}
                </text>
                <text
                  x={pos.x}
                  y={pos.y + (isProto ? 50 : 40)}
                  textAnchor="middle"
                  style={{
                    fill: "var(--c-text-1)",
                    fontFamily: "var(--font-serif)",
                    fontSize: 15,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {c.name}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Error state */}
        {loadError && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "var(--c-error)",
            }}
          >
            <h3 style={{ fontSize: 22, fontWeight: 600 }}>加载失败</h3>
            <p style={{ maxWidth: 480, textAlign: "center", color: "var(--c-text-3)" }}>
              {loadError}
            </p>
            <Button type="primary" onClick={reload}>
              重新加载
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!loadError && characters.length === 0 && !isLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "var(--c-text-4)",
            }}
          >
            <ApiOutlined style={{ fontSize: 56, color: "var(--c-primary-500)" }} />
            <h3
              style={{
                fontSize: 22,
                fontWeight: 600,
                fontFamily: "var(--font-serif)",
                color: "var(--c-text-2)",
              }}
            >
              还没有角色
            </h3>
            <p>点击右上角「新建角色」，开始编织你的人物关系网</p>
          </div>
        )}

        {/* Legend */}
        {relations.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 24,
              top: 24,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              padding: "8px 12px",
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
              borderRadius: 99,
              boxShadow: "var(--sh-sm)",
            }}
          >
            {relationCategoriesPresent.map((cat) => (
              <span key={cat} className="chip">
                <span
                  className="chip__dot"
                  style={{ background: RELATION_CATEGORIES[cat]?.color }}
                />
                {RELATION_CATEGORIES[cat]?.label}
              </span>
            ))}
          </div>
        )}

        {/* Avatar strip */}
        {characters.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 24px",
              background: "linear-gradient(to top, var(--c-surface), transparent)",
            }}
          >
            <div style={{ display: "flex", gap: 12, overflowX: "auto", flex: 1 }}>
              {characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`chip-av${c.id === selectedId ? " is-active" : ""}`}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-serif)",
                      fontWeight: 700,
                      fontSize: 14,
                      color: "#fff",
                      background: c.color,
                    }}
                  >
                    {initial(c.name)}
                  </span>
                  <span style={{ fontSize: 14, color: "var(--c-text-1)" }}>{c.name}</span>
                </button>
              ))}
            </div>
            <Button type="text" size="small" onClick={() => setShowStrip(!showStrip)}>
              {showStrip ? "收起" : "角色"}
            </Button>
          </div>
        )}
      </div>

      {/* Character detail drawer */}
      <Drawer open={drawerOpen} onClose={() => setSelectedId(null)} width={380} closable={false}>
        {selectedCharacter && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                paddingBottom: 20,
                borderBottom: "1px solid var(--c-border)",
              }}
            >
              <span
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-serif)",
                  fontWeight: 700,
                  fontSize: 22,
                  color: "#fff",
                  background: selectedCharacter.color,
                  flexShrink: 0,
                }}
              >
                {initial(selectedCharacter.name)}
              </span>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--c-primary-700)",
                  }}
                >
                  角色详情
                </span>
                <h3
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    fontFamily: "var(--font-serif)",
                    color: "var(--c-text-1)",
                  }}
                >
                  {selectedCharacter.name}
                </h3>
                {selectedCharacter.identity && (
                  <span
                    style={{
                      alignSelf: "flex-start",
                      fontSize: 12,
                      color: "var(--c-accent-700)",
                      background: "var(--c-accent-50)",
                      border: "1px solid var(--c-accent-100)",
                      padding: "1px 8px",
                      borderRadius: 99,
                    }}
                  >
                    {selectedCharacter.identity}
                  </span>
                )}
              </div>
              <Popconfirm
                title={`确定删除角色「${selectedCharacter.name}」吗？`}
                onConfirm={() => deleteCharacter(selectedCharacter)}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>

            <div style={{ padding: "20px 0", borderBottom: "1px solid var(--c-border)" }}>
              <h4
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--c-text-4)",
                  marginBottom: 12,
                }}
              >
                人物小传
              </h4>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: "var(--c-text-2)",
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {selectedCharacter.description || "暂无小传"}
              </p>
            </div>

            <div
              style={{
                padding: "20px 0",
                borderBottom: "1px solid var(--c-border)",
                flex: 1,
                overflow: "auto",
              }}
            >
              <h4
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--c-text-4)",
                  marginBottom: 12,
                }}
              >
                关系列表
              </h4>
              {selectedRelations.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {selectedRelations.map((rel) => (
                    <div
                      key={rel.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 16px",
                        background: "var(--c-surface-2)",
                        borderRadius: 8,
                        borderLeft: `3px solid ${RELATION_CATEGORIES[rel.category]?.color || "var(--c-border-strong)"}`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: RELATION_CATEGORIES[rel.category]?.color,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: 14, color: "var(--c-text-1)" }}>
                            {charName(rel.fromId)}{" "}
                            <ArrowRightOutlined
                              style={{ fontSize: 13, color: "var(--c-text-3)" }}
                            />{" "}
                            {charName(rel.toId)}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--c-text-3)",
                              background: "var(--c-surface)",
                              padding: "1px 8px",
                              borderRadius: 99,
                            }}
                          >
                            {RELATION_CATEGORIES[rel.category]?.label}
                          </span>
                        </div>
                        {(rel.label || rel.description) && (
                          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-text-4)" }}>
                            {rel.label}
                            {rel.label && rel.description && " · "}
                            {rel.description}
                          </p>
                        )}
                      </div>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => deleteRelation(rel)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 14, color: "var(--c-text-4)" }}>
                  暂无关系，点击「添加关系」连线
                </p>
              )}
            </div>

            <div
              style={{
                marginTop: "auto",
                display: "flex",
                gap: 12,
                paddingTop: 16,
                borderTop: "1px solid var(--c-border)",
              }}
            >
              <Button block onClick={() => openEditChar(selectedCharacter)}>
                编辑角色
              </Button>
              <Button
                block
                type="primary"
                icon={<ApiOutlined />}
                onClick={() => {
                  if (selectedCharacter) openAddRel(selectedCharacter.id);
                }}
              >
                添加关系
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Character create/edit dialog */}
      <Modal
        title={charForm.id ? "编辑角色" : "新建角色"}
        open={charDialogOpen}
        onCancel={() => setCharDialogOpen(false)}
        onOk={submitChar}
        width={460}
        okText="保存"
        cancelText="取消"
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="角色名" required>
            <Input
              value={charForm.name}
              onChange={(e) => setCharForm({ ...charForm, name: e.target.value })}
              placeholder="角色的名字"
              maxLength={20}
              showCount
            />
          </Form.Item>
          <Form.Item label="身份定位">
            <Input
              value={charForm.identity}
              onChange={(e) => setCharForm({ ...charForm, identity: e.target.value })}
              placeholder="主角 / 反派 / 配角…"
              maxLength={12}
            />
          </Form.Item>
          <Form.Item label="人物小传">
            <Input.TextArea
              value={charForm.description}
              onChange={(e) => setCharForm({ ...charForm, description: e.target.value })}
              placeholder="一句话勾勒这个人物…"
              rows={3}
              maxLength={300}
              showCount
            />
          </Form.Item>
          <Form.Item label="标签色">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {CHARACTER_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCharForm({ ...charForm, color: c })}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: c,
                    cursor: "pointer",
                    border:
                      charForm.color === c ? "2px solid var(--c-text-1)" : "2px solid transparent",
                    boxShadow:
                      charForm.color === c
                        ? "0 0 0 2px var(--c-surface), 0 0 0 4px var(--c-text-1)"
                        : "none",
                    transition: "transform 0.14s",
                  }}
                />
              ))}
            </div>
          </Form.Item>
        </Form>
      </Modal>

      {/* Relation dialog */}
      <Modal
        title="添加关系"
        open={relDialogOpen}
        onCancel={() => setRelDialogOpen(false)}
        width={460}
        okText="保存关系"
        cancelText="取消"
        okButtonProps={{ disabled: !canSubmitRel, loading: savingRel, icon: <ApiOutlined /> }}
        onOk={submitRel}
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="关系起点" required>
            <Select
              value={relForm.fromId || undefined}
              onChange={(v) => setRelForm({ ...relForm, fromId: v })}
              placeholder="选择角色"
              options={characters.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item label="关系终点" required>
            <Select
              value={relForm.toId || undefined}
              onChange={(v) => setRelForm({ ...relForm, toId: v })}
              placeholder="选择角色"
              options={characters.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item label="关系类别" required>
            <Select
              value={relForm.category}
              onChange={(v) => setRelForm({ ...relForm, category: v })}
              options={Object.entries(RELATION_CATEGORIES).map(([key, meta]) => ({
                value: key,
                label: meta.label,
              }))}
            />
          </Form.Item>
          <Form.Item label="关系标签">
            <Input
              value={relForm.label}
              onChange={(e) => setRelForm({ ...relForm, label: e.target.value })}
              placeholder="如：父子 / 宿敌 / 夫妻"
              maxLength={12}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {LABEL_SUGGEST.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRelForm({ ...relForm, label: s })}
                  style={{
                    fontSize: 12,
                    color: "var(--c-text-3)",
                    background: "var(--c-surface-2)",
                    border: "1px solid var(--c-border)",
                    borderRadius: 99,
                    padding: "2px 8px",
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea
              value={relForm.description}
              onChange={(e) => setRelForm({ ...relForm, description: e.target.value })}
              placeholder="可选"
              rows={2}
              maxLength={200}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
