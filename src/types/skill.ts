// 技能中心类型定义（与 Rust 后端 camelCase serde 对齐）

export type SkillType = "prompt" | "tool" | "agent";
export type SkillStatus = "active" | "disabled" | "quarantined" | "broken";
export type RiskLevel = "P0" | "P1" | "P2" | "";
export type AuditDecision = "passed" | "rejected" | "";

export interface SkillPermissions {
  fs: string[];
  network: boolean;
  commands: string[];
  aiInvoke: boolean;
}

export interface Skill {
  id: string;
  name: string;
  title: string;
  description: string;
  author: string;
  version: string;
  skillType: SkillType;
  source: string;
  status: SkillStatus;
  manifestPath: string;
  checksum: string;
  signature: string;
  permissions: SkillPermissions;
  minAppVersion: string;
  triggers: string[];
  riskLevel: RiskLevel;
  installedAt: string;
  updateAvailable: boolean;
  /** 是否随应用内置的默认技能：不可卸载，可编辑（编辑写入用户目录 override）。 */
  isBuiltin: boolean;
}

export interface SkillAuditLog {
  id: string;
  skillId: string;
  ranAt: string;
  riskLevel: RiskLevel;
  findings: string;
  decision: AuditDecision;
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  title: string;
  description: string;
  author: string;
  version: string;
  skillType: SkillType;
  riskLevel: RiskLevel;
  installs: number;
  downloadUrl: string;
  checksum: string;
  permissions: SkillPermissions;
}

/// 已启用 prompt 技能回传给 AI 面板的提示词片段，用于对话时自动注入 system 上下文。
export interface SkillPrompt {
  id: string;
  title: string;
  prompt: string;
}

/// `execute_skill` 的执行结果。
export interface SkillExecResult {
  /** prompt | tool | agent */
  kind: string;
  content: string;
  /** 是否已在当前构建中具备运行时执行能力 */
  ready: boolean;
}

export const SKILL_TYPE_LABELS: Record<SkillType, string> = {
  prompt: "提示词包",
  tool: "工具包",
  agent: "Agent 工作流",
};

export const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  active: "已启用",
  disabled: "已禁用",
  quarantined: "已隔离",
  broken: "解析失败",
};

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  P0: "高危",
  P1: "中危",
  P2: "低危",
  "": "未评级",
};
