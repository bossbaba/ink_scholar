import {
  ApiOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FunctionOutlined,
  InboxOutlined,
  InfoCircleFilled,
  LinkOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ToolOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Checkbox, Drawer, Input, Modal, message, Progress, Switch, Tabs } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useSkillStore } from "@/stores/useSkillStore";
import type {
  MarketplaceSkill,
  RiskLevel,
  Skill,
  SkillPermissions,
  SkillStatus,
  SkillType,
} from "@/types";

// ===== Meta maps =====
const TYPE_META: Record<
  SkillType,
  { label: string; iconBg: string; iconColor: string; icon: React.ReactNode }
> = {
  prompt: {
    label: "提示词",
    iconBg: "var(--c-primary-50)",
    iconColor: "var(--c-primary-600)",
    icon: <EditOutlined />,
  },
  tool: {
    label: "工具",
    iconBg: "var(--c-accent-50)",
    iconColor: "var(--c-accent-600)",
    icon: <ToolOutlined />,
  },
  agent: { label: "Agent", iconBg: "#E8F5E9", iconColor: "#2E7D32", icon: <ApiOutlined /> },
};

const STATUS_META: Record<SkillStatus, { label: string; color: string }> = {
  active: { label: "已启用", color: "var(--c-success)" },
  disabled: { label: "已禁用", color: "var(--c-text-4)" },
  quarantined: { label: "已隔离", color: "var(--c-warning)" },
  broken: { label: "解析失败", color: "var(--c-error)" },
};

const RISK_META: Record<RiskLevel, { label: string; color: string; bg: string }> = {
  P0: { label: "高危", color: "var(--c-error)", bg: "var(--c-error-bg)" },
  P1: { label: "中危", color: "var(--c-warning)", bg: "var(--c-warning-bg)" },
  P2: { label: "低危", color: "var(--c-success)", bg: "var(--c-success-bg)" },
  "": { label: "未评级", color: "var(--c-text-3)", bg: "var(--c-surface-2)" },
};

function sourceLabel(src: string) {
  if (src === "builtin") return "内置";
  if (src === "official" || src === "market") return "官方市场";
  if (src === "imported") return "自托管";
  return "本地";
}

interface PermRow {
  key: string;
  name: string;
  icon: React.ReactNode;
  scope: string;
}
function permissionRows(p: SkillPermissions): PermRow[] {
  const rows: PermRow[] = [];
  if (p.network)
    rows.push({ key: "network", name: "网络访问", icon: <LinkOutlined />, scope: "network:*" });
  if (p.fs.length)
    rows.push({ key: "fs", name: "文件系统", icon: <FileTextOutlined />, scope: p.fs.join(", ") });
  if (p.commands.length)
    rows.push({
      key: "commands",
      name: "命令执行",
      icon: <SettingOutlined />,
      scope: p.commands.join(", "),
    });
  if (p.aiInvoke)
    rows.push({ key: "ai", name: "AI 调用", icon: <FunctionOutlined />, scope: "ai:invoke" });
  return rows;
}

export default function Skills() {
  const skillStore = useSkillStore();
  const skills = useSkillStore((s) => s.skills);
  const marketplaceSkills = useSkillStore((s) => s.marketplaceSkills);

  const [activeTab, setActiveTab] = useState<"installed" | "market" | "import">("installed");
  const [typeFilter, setTypeFilter] = useState<"all" | SkillType>("all");
  const [skillSearch, setSkillSearch] = useState("");
  const [marketRegistryUrl, setMarketRegistryUrl] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);

  // Drawer
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  // Audit
  const [auditVisible, setAuditVisible] = useState(false);
  const [auditStage, setAuditStage] = useState<"progress" | "result">("progress");
  const [auditing, setAuditing] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [auditResult, setAuditResult] = useState<{
    riskLevel: RiskLevel;
    decision: string;
    findings: string;
  } | null>(null);
  const [auditFindings, setAuditFindings] = useState<string[]>([]);
  const [auditTargetName, setAuditTargetName] = useState("");
  const [auditTargetId, setAuditTargetId] = useState("");
  const [auditTargetPerms, setAuditTargetPerms] = useState<SkillPermissions>({
    fs: [],
    network: false,
    commands: [],
    aiInvoke: false,
  });
  const [auditConfirmed, setAuditConfirmed] = useState(false);

  // Edit
  const [editVisible, setEditVisible] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState({ title: "", description: "", triggers: "", entry: "" });

  // Import
  const [importUrl, setImportUrl] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [localDirPath, setLocalDirPath] = useState("");
  const [importing, setImporting] = useState(false);
  const [importKind, setImportKind] = useState("");

  // Filters
  const filteredSkills = useMemo(
    () =>
      skills.filter((s) => {
        if (typeFilter !== "all" && s.skillType !== typeFilter) return false;
        const q = skillSearch.trim().toLowerCase();
        if (q && !`${s.title} ${s.name} ${s.author} ${s.description}`.toLowerCase().includes(q))
          return false;
        return true;
      }),
    [skills, typeFilter, skillSearch],
  );

  const filteredMarket = useMemo(
    () =>
      marketplaceSkills.filter((m) => {
        if (typeFilter !== "all" && m.skillType !== typeFilter) return false;
        const q = skillSearch.trim().toLowerCase();
        if (q && !`${m.title} ${m.name} ${m.author} ${m.description}`.toLowerCase().includes(q))
          return false;
        return true;
      }),
    [marketplaceSkills, typeFilter, skillSearch],
  );

  // Init
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount to scan local skills and load the marketplace; loadMarket is recreated every render so depending on it would loop
  useEffect(() => {
    skillStore.scanLocalSkills().catch(() => {});
    loadMarket();
  }, []);

  // Market
  async function loadMarket() {
    setMarketLoading(true);
    try {
      await skillStore.listMarketplace(marketRegistryUrl.trim() || undefined);
    } catch (e) {
      message.error(`市场加载失败：${(e as Error).message ?? e}`);
    } finally {
      setMarketLoading(false);
    }
  }

  // Toggle
  async function onToggle(s: Skill) {
    if (s.status === "broken") return;
    if (s.status === "active") {
      await skillStore.disableSkill(s.id);
      if (selectedSkill?.id === s.id) setSelectedSkill({ ...s, status: "disabled" });
      message.success("已禁用");
      return;
    }
    if (s.status === "quarantined" || s.riskLevel === "") {
      await runAuditFlow(s);
      return;
    }
    await skillStore.enableSkill(s.id);
    if (selectedSkill?.id === s.id) setSelectedSkill({ ...s, status: "active" });
    message.success("已启用，提示词将在 AI 对话中自动生效");
  }

  async function uninstall(s: Skill) {
    await skillStore.uninstallSkill(s.id);
    setDrawerVisible(false);
    message.success("已卸载");
  }

  // Edit
  async function openEdit(s: Skill) {
    try {
      const m = await skillStore.getSkillManifest(s.id);
      setEditingId(s.id);
      setEditForm({
        title: String(m.title ?? s.title ?? ""),
        description: String(m.description ?? s.description ?? ""),
        triggers: Array.isArray(m.triggers) ? (m.triggers as unknown[]).map(String).join(", ") : "",
        entry:
          typeof m.entry === "string"
            ? m.entry
            : m.entry &&
                typeof m.entry === "object" &&
                typeof (m.entry as unknown as { prompt?: unknown }).prompt === "string"
              ? String((m.entry as unknown as { prompt?: unknown }).prompt)
              : m.entry
                ? JSON.stringify(m.entry, null, 2)
                : "",
      });
      setEditVisible(true);
    } catch (e) {
      message.error(`读取技能内容失败：${(e as Error).message ?? e}`);
    }
  }

  async function saveEdit() {
    if (!editingId.trim()) return;
    setEditSaving(true);
    try {
      const triggers = editForm.triggers
        .split(/[,，]/u)
        .map((t) => t.trim())
        .filter(Boolean);
      const updated = await skillStore.updateSkillManifest(editingId, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        triggers,
        entry: editForm.entry,
      });
      setSelectedSkill(updated);
      setEditVisible(false);
      message.success("已保存");
    } catch (e) {
      message.error(`保存失败：${(e as Error).message ?? e}`);
    } finally {
      setEditSaving(false);
    }
  }

  // Import
  async function submitImportUrl() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportKind("url");
    try {
      const skill = await skillStore.importFromUrl(importUrl.trim());
      setImportUrl("");
      await runAuditFlow(skill);
    } catch (e) {
      message.error(`导入失败：${(e as Error).message ?? e}`);
    } finally {
      setImporting(false);
      setImportKind("");
    }
  }

  async function submitImportGit() {
    if (!gitUrl.trim()) return;
    setImporting(true);
    setImportKind("git");
    try {
      const skill = await skillStore.importFromGit(gitUrl.trim());
      setGitUrl("");
      await runAuditFlow(skill);
    } catch (e) {
      message.error(`导入失败：${(e as Error).message ?? e}`);
    } finally {
      setImporting(false);
      setImportKind("");
    }
  }

  async function pickLocalDir() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setLocalDirPath(selected);
  }

  async function submitImportDir() {
    if (!localDirPath) return;
    setImporting(true);
    setImportKind("dir");
    try {
      const skill = await skillStore.importFromDir(localDirPath);
      setLocalDirPath("");
      await runAuditFlow(skill);
    } catch (e) {
      message.error(`导入失败：${(e as Error).message ?? e}`);
    } finally {
      setImporting(false);
      setImportKind("");
    }
  }

  async function installFromMarket(m: MarketplaceSkill) {
    if (!m.downloadUrl) return;
    setImporting(true);
    setAuditTargetId(m.id);
    try {
      const skill = await skillStore.importFromUrl(m.downloadUrl);
      await runAuditFlow(skill);
    } catch (e) {
      message.error(`安装失败：${(e as Error).message ?? e}`);
    } finally {
      setImporting(false);
      setAuditTargetId("");
    }
  }

  // Audit flow
  async function runAuditFlow(skill: Skill) {
    setAuditTargetName(skill.title);
    setAuditTargetId(skill.id);
    setAuditTargetPerms(skill.permissions);
    setAuditResult(null);
    setAuditFindings([]);
    setAuditConfirmed(false);
    setAuditStage("progress");
    setAuditVisible(true);
    setAuditing(true);
    try {
      const log = await skillStore.runAudit(skill.id);
      setAuditResult({ riskLevel: log.riskLevel, decision: log.decision, findings: log.findings });
      setAuditFindings(log.findings ? log.findings.split("\n").filter(Boolean) : []);
      setAuditStage("result");
    } catch (e) {
      message.error(`审计失败：${(e as Error).message ?? e}`);
      setAuditVisible(false);
    } finally {
      setAuditing(false);
    }
  }

  async function authorizeAndEnable() {
    if (!auditTargetId) return;
    setAuthorizing(true);
    try {
      await skillStore.enableSkill(auditTargetId);
      setAuditVisible(false);
      message.success("已授权并启用，提示词将在 AI 对话中自动生效");
      if (selectedSkill?.id === auditTargetId)
        setSelectedSkill({ ...selectedSkill, status: "active" });
    } catch (e) {
      message.error(`启用失败：${(e as Error).message ?? e}`);
    } finally {
      setAuthorizing(false);
    }
  }

  const canAuthorize =
    auditResult?.decision === "passed" && (auditResult?.riskLevel !== "P0" || auditConfirmed);

  // ===== Render helpers =====
  const typeFilterChips: { label: string; value: "all" | SkillType }[] = [
    { label: "全部", value: "all" },
    { label: "提示词", value: "prompt" },
    { label: "工具", value: "tool" },
    { label: "Agent", value: "agent" },
  ];

  const renderBadge = (t: SkillType) => {
    const m = TYPE_META[t];
    return (
      <span
        style={{
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 99,
          background: m.iconBg,
          color: m.iconColor,
          whiteSpace: "nowrap",
        }}
      >
        {m.label}
      </span>
    );
  };

  const renderStatusDot = (s: SkillStatus) => {
    const m = STATUS_META[s];
    return (
      <>
        <span
          style={{ width: 8, height: 8, borderRadius: "50%", background: m.color, flexShrink: 0 }}
        />
        <span style={{ fontSize: 12, marginLeft: -2, color: m.color }}>{m.label}</span>
      </>
    );
  };

  return (
    <div className="ui-page">
      <div className="ui-page__inner">
        <header className="page-head">
          <div>
            <p className="page-eyebrow">AI 能力</p>
            <h1 className="page-title">技能库</h1>
            <p className="page-subtitle">管理本地 AI 技能 · 从市场安装 · 安全审计后启用并注入 AI</p>
          </div>
        </header>

        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as typeof activeTab)}
          items={[
            { key: "installed", label: "已安装" },
            { key: "market", label: "市场" },
            { key: "import", label: "导入" },
          ]}
        />

        {activeTab !== "import" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <div className="pill-group">
              {typeFilterChips.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`pill ${typeFilter === t.value ? "pill--active" : ""}`}
                  onClick={() => setTypeFilter(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder="搜索技能名称 / 作者"
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
              style={{ width: 260, maxWidth: "100%" }}
            />
          </div>
        )}

        {/* ===== Installed tab ===== */}
        {activeTab === "installed" && (
          <section style={{ minHeight: 200 }}>
            {skillStore.loading ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                  gap: 16,
                }}
              >
                {["sk0", "sk1", "sk2", "sk3", "sk4", "sk5"].map((k) => (
                  <div
                    key={k}
                    style={{
                      height: 168,
                      background: "var(--c-surface)",
                      borderRadius: "var(--r-lg)",
                      animation: "pulse 1.4s ease infinite",
                    }}
                  />
                ))}
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="empty-box">
                <InboxOutlined style={{ fontSize: 48, color: "var(--c-text-4)" }} />
                <p
                  style={{ fontSize: 16, fontWeight: 600, color: "var(--c-text-1)", marginTop: 12 }}
                >
                  还没有已安装技能
                </p>
                <p style={{ fontSize: 14, color: "var(--c-text-3)", marginBottom: 16 }}>
                  从「市场」安装，或在「导入」中加载自托管技能。
                </p>
                <Button type="primary" shape="round" onClick={() => setActiveTab("market")}>
                  去市场看看
                </Button>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                  gap: 16,
                }}
              >
                {filteredSkills.map((s) => (
                  // biome-ignore lint/a11y/useSemanticElements: clickable skill card uses role=button + keyboard handler as the correct accessible pattern
                  <div
                    key={s.id}
                    className="tile-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedSkill(s);
                      setDrawerVisible(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setSelectedSkill(s);
                        setDrawerVisible(true);
                      }
                    }}
                  >
                    <div className="tile-card__head">
                      <span
                        className="tile-card__icon"
                        style={{
                          background: TYPE_META[s.skillType].iconBg,
                          color: TYPE_META[s.skillType].iconColor,
                        }}
                      >
                        {TYPE_META[s.skillType].icon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 className="tile-card__title">{s.title}</h3>
                        <div className="tile-card__sub">
                          <span className="tile-card__ver">v{s.version}</span>
                          {s.author && (
                            <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>
                              {s.author}
                            </span>
                          )}
                        </div>
                      </div>
                      {s.status !== "broken" ? (
                        <Switch
                          checked={s.status === "active"}
                          disabled={auditing}
                          onClick={(_checked, e) => {
                            e.stopPropagation();
                            onToggle(s);
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--c-error)",
                            background: "var(--c-error-bg)",
                            padding: "2px 8px",
                            borderRadius: 99,
                          }}
                        >
                          解析失败
                        </span>
                      )}
                    </div>
                    <p className="tile-card__desc">{s.description || "暂无描述"}</p>
                    <div className="tile-card__foot">
                      {renderBadge(s.skillType)}
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 99,
                          background: "var(--c-surface-2)",
                          color: "var(--c-text-3)",
                        }}
                      >
                        {sourceLabel(s.source)}
                      </span>
                      {s.updateAvailable && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 99,
                            background: "var(--c-accent-50)",
                            color: "var(--c-accent-700)",
                          }}
                        >
                          可更新
                        </span>
                      )}
                      {renderStatusDot(s.status)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ===== Market tab ===== */}
        {activeTab === "market" && (
          <section style={{ minHeight: 200 }}>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <Input
                prefix={<LinkOutlined />}
                allowClear
                placeholder="官方市场源地址（留空使用默认空市场）"
                value={marketRegistryUrl}
                onChange={(e) => setMarketRegistryUrl(e.target.value)}
                onPressEnter={loadMarket}
              />
              <Button
                shape="round"
                icon={<ReloadOutlined />}
                loading={marketLoading}
                onClick={loadMarket}
              >
                加载
              </Button>
            </div>
            {filteredMarket.length === 0 ? (
              <div className="empty-box">
                <ShopOutlined style={{ fontSize: 48, color: "var(--c-text-4)" }} />
                <p
                  style={{ fontSize: 16, fontWeight: 600, color: "var(--c-text-1)", marginTop: 12 }}
                >
                  市场暂无可用技能
                </p>
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--c-text-3)",
                    maxWidth: 320,
                    margin: "0 auto 16px",
                  }}
                >
                  未配置市场源，或当前市场源为空。你仍能在「导入」中加载自托管 Git / URL 技能。
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                  gap: 16,
                }}
              >
                {filteredMarket.map((m) => (
                  <article key={m.id} className="tile-card">
                    <div className="tile-card__head">
                      <span
                        className="tile-card__icon"
                        style={{
                          background: TYPE_META[m.skillType].iconBg,
                          color: TYPE_META[m.skillType].iconColor,
                        }}
                      >
                        {TYPE_META[m.skillType].icon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 className="tile-card__title">{m.title}</h3>
                        <div className="tile-card__sub">
                          <span className="tile-card__ver">v{m.version}</span>
                          {m.author && (
                            <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>
                              {m.author}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="tile-card__desc">{m.description || "暂无描述"}</p>
                    <div className="tile-card__foot">
                      {renderBadge(m.skillType)}
                      {m.installs > 0 && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 99,
                            background: "var(--c-surface-2)",
                            color: "var(--c-text-3)",
                          }}
                        >
                          {m.installs} 次安装
                        </span>
                      )}
                      {RISK_META[m.riskLevel]?.label !== "未评级" && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 99,
                            background: RISK_META[m.riskLevel].bg,
                            color: RISK_META[m.riskLevel].color,
                          }}
                        >
                          {RISK_META[m.riskLevel].label}
                        </span>
                      )}
                      <Button
                        type="primary"
                        shape="round"
                        size="small"
                        style={{ marginLeft: "auto" }}
                        loading={auditing && auditTargetId === m.id}
                        onClick={() => installFromMarket(m)}
                      >
                        安装
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ===== Import tab ===== */}
        {activeTab === "import" && (
          <section
            style={{
              maxWidth: 680,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <ImportCard
              title="从 URL 导入"
              hint="粘贴技能压缩包（.zip）直链，下载后自动落盘并审计。"
            >
              <Input
                prefix={<LinkOutlined />}
                placeholder="https://example.com/skill.zip"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              <Button
                type="primary"
                shape="round"
                block
                loading={importing && importKind === "url"}
                disabled={!importUrl.trim()}
                onClick={submitImportUrl}
              >
                从 URL 导入
              </Button>
            </ImportCard>
            <ImportCard
              title="从 Git 仓库导入"
              hint="克隆公开仓库（--depth 1），自动定位含 skill.json 的目录。"
            >
              <Input
                prefix={<LinkOutlined />}
                placeholder="https://github.com/user/skill-repo.git"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              <Button
                type="primary"
                shape="round"
                block
                loading={importing && importKind === "git"}
                disabled={!gitUrl.trim()}
                onClick={submitImportGit}
              >
                从 Git 仓库导入
              </Button>
            </ImportCard>
            <ImportCard title="从本地目录导入" hint="选择含 skill.json 的本地技能文件夹。">
              {/* biome-ignore lint/a11y/useSemanticElements: accessible custom button; role=button + keyboard handler is the correct pattern here */}
              <div
                role="button"
                tabIndex={0}
                onClick={pickLocalDir}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") pickLocalDir();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px dashed var(--c-border-strong)",
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 12,
                  cursor: "pointer",
                  color: "var(--c-text-3)",
                  transition: "all 0.14s",
                }}
              >
                <FolderOpenOutlined style={{ fontSize: 22, flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 14,
                    color: localDirPath ? "var(--c-text-2)" : "var(--c-text-3)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {localDirPath || "点击选择本地目录"}
                </span>
              </div>
              <Button
                type="primary"
                shape="round"
                block
                loading={importing && importKind === "dir"}
                disabled={!localDirPath}
                onClick={submitImportDir}
              >
                从本地目录导入
              </Button>
            </ImportCard>
          </section>
        )}

        {/* ===== Detail drawer ===== */}
        <Drawer
          open={drawerVisible}
          onClose={() => {
            setDrawerVisible(false);
            setSelectedSkill(null);
          }}
          width={typeof window !== "undefined" && window.innerWidth <= 768 ? "92vw" : 440}
          closable={false}
        >
          {selectedSkill && (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  className="tile-card__icon"
                  style={{
                    background: TYPE_META[selectedSkill.skillType].iconBg,
                    color: TYPE_META[selectedSkill.skillType].iconColor,
                    width: 56,
                    height: 56,
                    fontSize: 24,
                  }}
                >
                  {TYPE_META[selectedSkill.skillType].icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: 20,
                      fontWeight: 600,
                      color: "var(--c-text-1)",
                    }}
                  >
                    {selectedSkill.title}
                  </h2>
                  <p style={{ fontSize: 12, color: "var(--c-text-3)", marginTop: 2 }}>
                    {selectedSkill.author} · v{selectedSkill.version}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDrawerVisible(false);
                    setSelectedSkill(null);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--c-text-3)",
                    cursor: "pointer",
                    padding: 4,
                    borderRadius: 4,
                  }}
                >
                  <CloseOutlined />
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "12px 0 16px",
                  flexWrap: "wrap",
                }}
              >
                {renderBadge(selectedSkill.skillType)}
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: "var(--c-surface-2)",
                    color: "var(--c-text-3)",
                  }}
                >
                  {sourceLabel(selectedSkill.source)}
                </span>
                {renderStatusDot(selectedSkill.status)}
              </div>

              <DetailSection label="描述">
                <p style={{ fontSize: 14, color: "var(--c-text-2)", lineHeight: 1.6 }}>
                  {selectedSkill.description || "暂无描述"}
                </p>
              </DetailSection>

              <DetailSection label="清单信息">
                <dl style={{ margin: 0 }}>
                  {[
                    ["技能 ID", selectedSkill.id],
                    ["版本", `v${selectedSkill.version}`],
                    ["最低版本", selectedSkill.minAppVersion || "—"],
                    ["来源", selectedSkill.source],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "4px 0",
                        fontSize: 14,
                      }}
                    >
                      <dt style={{ color: "var(--c-text-3)", flexShrink: 0 }}>{k}</dt>
                      <dd
                        style={{
                          color: "var(--c-text-1)",
                          textAlign: "right",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {v}
                      </dd>
                    </div>
                  ))}
                  {selectedSkill.triggers.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "4px 0",
                        fontSize: 14,
                      }}
                    >
                      <dt style={{ color: "var(--c-text-3)", flexShrink: 0 }}>触发词</dt>
                      <dd
                        style={{
                          color: "var(--c-text-1)",
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {selectedSkill.triggers.join(", ")}
                      </dd>
                    </div>
                  )}
                </dl>
              </DetailSection>

              <DetailSection label="请求的权限">
                {permissionRows(selectedSkill.permissions).length > 0 ? (
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {permissionRows(selectedSkill.permissions).map((row) => (
                      <li
                        key={row.key}
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}
                      >
                        <span style={{ color: "var(--c-primary-500)", flexShrink: 0 }}>
                          {row.icon}
                        </span>
                        <span style={{ color: "var(--c-text-2)", flexShrink: 0 }}>{row.name}</span>
                        <span
                          style={{
                            color: "var(--c-text-4)",
                            fontSize: 11,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {row.scope}
                        </span>
                        <CheckCircleFilled
                          style={{ color: "var(--c-success)", marginLeft: "auto", flexShrink: 0 }}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: 14, color: "var(--c-text-3)" }}>未声明任何权限</p>
                )}
              </DetailSection>

              <DetailSection label="最近审计">
                <button
                  type="button"
                  onClick={() => runAuditFlow(selectedSkill)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    border: "none",
                    background: "transparent",
                    color: "var(--c-primary-600)",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                    marginBottom: 8,
                  }}
                >
                  <ReloadOutlined style={{ fontSize: 14 }} /> 重新审计
                </button>
                {selectedSkill.riskLevel ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 99,
                        background: RISK_META[selectedSkill.riskLevel].bg,
                        color: RISK_META[selectedSkill.riskLevel].color,
                        fontWeight: 600,
                      }}
                    >
                      {RISK_META[selectedSkill.riskLevel].label}
                    </span>
                    <span style={{ fontSize: 14, color: "var(--c-text-3)" }}>
                      启用前需通过安全审计
                    </span>
                  </div>
                ) : (
                  <p style={{ fontSize: 14, color: "var(--c-text-3)" }}>尚未审计</p>
                )}
              </DetailSection>

              <div
                style={{
                  marginTop: "auto",
                  paddingTop: 16,
                  borderTop: "1px solid var(--c-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Switch
                    checked={selectedSkill.status === "active"}
                    disabled={selectedSkill.status === "broken" || auditing}
                    onChange={() => onToggle(selectedSkill)}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      color:
                        selectedSkill.status === "active" ? "var(--c-success)" : "var(--c-text-4)",
                    }}
                  >
                    {selectedSkill.status === "active" ? "已启用" : "已禁用"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!selectedSkill.isBuiltin && selectedSkill.status !== "broken" && (
                    <Button type="text" danger onClick={() => uninstall(selectedSkill)}>
                      <DeleteOutlined /> 卸载
                    </Button>
                  )}
                  {selectedSkill.status !== "broken" && (
                    <Button type="text" onClick={() => openEdit(selectedSkill)}>
                      <EditOutlined /> 编辑
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </Drawer>

        {/* ===== Audit dialog ===== */}
        <Modal
          open={auditVisible}
          onCancel={() => setAuditVisible(false)}
          closable={false}
          width={520}
          footer={[
            <Button key="cancel" shape="round" onClick={() => setAuditVisible(false)}>
              取消
            </Button>,
            <Button
              key="ok"
              shape="round"
              type="primary"
              disabled={!canAuthorize}
              loading={authorizing}
              onClick={authorizeAndEnable}
            >
              授权并启用
            </Button>,
          ]}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            {auditStage === "result" ? (
              <span
                className="tile-card__icon"
                style={{
                  width: 44,
                  height: 44,
                  background: RISK_META[auditResult?.riskLevel ?? ""].bg,
                  color: RISK_META[auditResult?.riskLevel ?? ""].color,
                }}
              >
                {auditResult?.riskLevel === "P0" ? (
                  <WarningFilled />
                ) : auditResult?.riskLevel === "P1" ? (
                  <CloseCircleOutlined />
                ) : (
                  <CheckCircleOutlined />
                )}
              </span>
            ) : (
              <span
                className="tile-card__icon"
                style={{
                  width: 44,
                  height: 44,
                  color: "var(--c-primary-500)",
                  background: "var(--c-primary-50)",
                  animation: "spin 1s linear infinite",
                }}
              >
                <LoadingOutlined />
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--c-text-1)" }}>安全审计</h3>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--c-text-3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {auditTargetName}
              </p>
            </div>
          </div>

          {auditStage === "progress" ? (
            <div style={{ padding: "16px 0" }}>
              <Progress
                percent={100}
                showInfo={false}
                status="active"
                strokeColor="var(--c-primary-500)"
              />
              <p
                style={{
                  fontSize: 14,
                  color: "var(--c-text-3)",
                  marginTop: 12,
                  textAlign: "center",
                }}
              >
                正在扫描 Manifest 与静态危险能力…
              </p>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: RISK_META[auditResult?.riskLevel ?? ""].bg,
                    color: RISK_META[auditResult?.riskLevel ?? ""].color,
                  }}
                >
                  {RISK_META[auditResult?.riskLevel ?? ""].label}
                </span>
                <span style={{ fontSize: 14, color: "var(--c-text-2)" }}>
                  {auditResult?.decision === "rejected"
                    ? "校验未通过，已隔离，禁止启用"
                    : auditResult?.riskLevel === "P0"
                      ? "检测到高危能力，需二次确认后授权"
                      : auditResult?.riskLevel === "P1"
                        ? "存在需关注的能力，确认后可启用"
                        : "未检出高危能力，可安全启用"}
                </span>
              </div>

              <div style={{ marginBottom: 16 }}>
                <h4
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: "var(--c-text-4)",
                    marginBottom: 8,
                  }}
                >
                  审计发现
                </h4>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {auditFindings.map((f) => (
                    <li
                      key={f}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        fontSize: 14,
                        color: "var(--c-text-2)",
                        lineHeight: 1.5,
                      }}
                    >
                      <InfoCircleFilled
                        style={{ color: "var(--c-primary-500)", flexShrink: 0, marginTop: 2 }}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {permissionRows(auditTargetPerms).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      color: "var(--c-text-4)",
                      marginBottom: 8,
                    }}
                  >
                    将授予的权限
                  </h4>
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {permissionRows(auditTargetPerms).map((row) => (
                      <li
                        key={row.key}
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}
                      >
                        <span style={{ color: "var(--c-primary-500)", flexShrink: 0 }}>
                          {row.icon}
                        </span>
                        <span style={{ color: "var(--c-text-2)", flexShrink: 0 }}>{row.name}</span>
                        <span
                          style={{
                            color: "var(--c-text-4)",
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {row.scope}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {auditResult?.riskLevel === "P0" && auditResult?.decision === "passed" && (
                <label
                  htmlFor="audit-confirm"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: 12,
                    background: "var(--c-error-bg)",
                    borderRadius: 8,
                    fontSize: 14,
                    color: "var(--c-error)",
                    marginTop: 8,
                    cursor: "pointer",
                  }}
                >
                  <Checkbox
                    id="audit-confirm"
                    checked={auditConfirmed}
                    onChange={(e) => setAuditConfirmed(e.target.checked)}
                  />
                  <span>我已知悉该技能存在高危能力，仍要授权并启用</span>
                </label>
              )}
            </div>
          )}
        </Modal>

        {/* ===== Edit dialog ===== */}
        <Modal
          title="编辑技能"
          open={editVisible}
          onCancel={() => setEditVisible(false)}
          width={560}
          closable={!editSaving}
          footer={[
            <Button
              key="cancel"
              shape="round"
              disabled={editSaving}
              onClick={() => setEditVisible(false)}
            >
              取消
            </Button>,
            <Button key="ok" shape="round" type="primary" loading={editSaving} onClick={saveEdit}>
              保存
            </Button>,
          ]}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label
              htmlFor="edit-title"
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: "var(--c-text-4)",
              }}
            >
              标题
            </label>
            <Input
              id="edit-title"
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              placeholder="技能标题"
              maxLength={60}
            />
            <label
              htmlFor="edit-description"
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: "var(--c-text-4)",
              }}
            >
              描述
            </label>
            <Input.TextArea
              id="edit-description"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              placeholder="技能描述"
              rows={2}
              maxLength={200}
            />
            <label
              htmlFor="edit-triggers"
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: "var(--c-text-4)",
              }}
            >
              触发词（逗号分隔）
            </label>
            <Input
              id="edit-triggers"
              value={editForm.triggers}
              onChange={(e) => setEditForm({ ...editForm, triggers: e.target.value })}
              placeholder="大纲, outline"
            />
            <label
              htmlFor="edit-entry"
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: "var(--c-text-4)",
              }}
            >
              提示词内容
            </label>
            <Input.TextArea
              id="edit-entry"
              value={editForm.entry}
              onChange={(e) => setEditForm({ ...editForm, entry: e.target.value })}
              placeholder="系统提示词文本…"
              rows={10}
              style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6 }}
            />
          </div>
        </Modal>
      </div>
    </div>
  );
}

function ImportCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-card">
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--c-text-1)", marginBottom: 4 }}>
        {title}
      </h3>
      <p style={{ fontSize: 14, color: "var(--c-text-3)", marginBottom: 12 }}>{hint}</p>
      {children}
    </div>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 0", borderTop: "1px solid var(--c-border)" }}>
      <h4
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.04em",
          color: "var(--c-text-4)",
          marginBottom: 8,
        }}
      >
        {label}
      </h4>
      {children}
    </div>
  );
}
