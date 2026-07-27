import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  MarketplaceSkill,
  RiskLevel,
  Skill,
  SkillAuditLog,
  SkillExecResult,
  SkillPermissions,
  SkillPrompt,
  SkillStatus,
  SkillType,
} from "@/types";

// ===== Normalize helpers =====

function normalizePermissions(raw: unknown): SkillPermissions {
  const data = (raw ?? {}) as Record<string, unknown>;
  const strArr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    fs: strArr(data.fs),
    network: Boolean(data.network),
    commands: strArr(data.commands),
    aiInvoke: Boolean(data.aiInvoke),
  };
}

function normalizeSkill(raw: unknown): Skill {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    name: String(data.name ?? ""),
    title: String(data.title ?? data.name ?? ""),
    description: String(data.description ?? ""),
    author: String(data.author ?? ""),
    version: String(data.version ?? ""),
    skillType: (data.skill_type ?? data.skillType ?? "prompt") as SkillType,
    source: String(data.source ?? "local"),
    status: (data.status ?? "disabled") as SkillStatus,
    manifestPath: String(data.manifest_path ?? data.manifestPath ?? ""),
    checksum: String(data.checksum ?? ""),
    signature: String(data.signature ?? ""),
    permissions: normalizePermissions(data.permissions),
    minAppVersion: String(data.min_app_version ?? data.minAppVersion ?? ""),
    triggers: Array.isArray(data.triggers)
      ? (data.triggers as unknown[]).map((t) => String(t))
      : [],
    riskLevel: (data.risk_level ?? data.riskLevel ?? "") as RiskLevel,
    installedAt: String(data.installed_at ?? data.installedAt ?? ""),
    updateAvailable: Boolean(data.update_available ?? data.updateAvailable ?? false),
    isBuiltin: Boolean(data.is_builtin ?? data.isBuiltin ?? false),
  };
}

function normalizeAuditLog(raw: unknown): SkillAuditLog {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    skillId: String(data.skill_id ?? data.skillId ?? ""),
    ranAt: String(data.ran_at ?? data.ranAt ?? ""),
    riskLevel: (data.risk_level ?? data.riskLevel ?? "") as RiskLevel,
    findings: String(data.findings ?? ""),
    decision: (data.decision ?? "") as SkillAuditLog["decision"],
  };
}

function normalizeMarketplace(raw: unknown): MarketplaceSkill {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    name: String(data.name ?? ""),
    title: String(data.title ?? data.name ?? ""),
    description: String(data.description ?? ""),
    author: String(data.author ?? ""),
    version: String(data.version ?? ""),
    skillType: (data.skill_type ?? data.skillType ?? "prompt") as SkillType,
    riskLevel: (data.risk_level ?? data.riskLevel ?? "") as RiskLevel,
    installs: Number(data.installs ?? 0),
    downloadUrl: String(data.download_url ?? data.downloadUrl ?? ""),
    checksum: String(data.checksum ?? ""),
    permissions: normalizePermissions(data.permissions),
  };
}

// Concurrent dedup for default skill prompts fetch
let _defaultPromptsInflight: Promise<Map<string, string>> | null = null;

// ===== Store interface =====

interface SkillState {
  skills: Skill[];
  loading: boolean;
  auditLogs: SkillAuditLog[];
  marketplaceSkills: MarketplaceSkill[];
  defaultSkillPrompts: Map<string, string>;

  scanLocalSkills: () => Promise<Skill[]>;
  listSkills: () => Promise<Skill[]>;
  enableSkill: (id: string) => Promise<void>;
  disableSkill: (id: string) => Promise<void>;
  uninstallSkill: (id: string) => Promise<void>;
  importFromDir: (src: string) => Promise<Skill>;
  importFromUrl: (url: string) => Promise<Skill>;
  importFromGit: (url: string) => Promise<Skill>;
  runAudit: (id: string) => Promise<SkillAuditLog>;
  getAuditLogs: (skillId: string) => Promise<SkillAuditLog[]>;
  listMarketplace: (registryUrl?: string) => Promise<MarketplaceSkill[]>;
  getActiveSkillPrompts: () => Promise<SkillPrompt[]>;
  executeSkill: (id: string, input: string) => Promise<SkillExecResult>;
  getSkillManifest: (id: string) => Promise<Record<string, unknown>>;
  updateSkillManifest: (id: string, patch: Record<string, unknown>) => Promise<Skill>;
  getDefaultSkillPrompts: () => Promise<Map<string, string>>;
}

export const useSkillStore = create<SkillState>((set, _get) => ({
  skills: [],
  loading: false,
  auditLogs: [],
  marketplaceSkills: [],
  defaultSkillPrompts: new Map(),

  scanLocalSkills: async () => {
    set({ loading: true });
    try {
      const raw = (await invoke("scan_local_skills")) as unknown[];
      const skills = raw.map(normalizeSkill);
      set({ skills });
      return skills;
    } finally {
      set({ loading: false });
    }
  },

  listSkills: async () => {
    const raw = (await invoke("list_skills")) as unknown[];
    const skills = raw.map(normalizeSkill);
    set({ skills });
    return skills;
  },

  enableSkill: async (id) => {
    await invoke("enable_skill", { id });
    set((s) => ({
      skills: s.skills.map((x) => (x.id === id ? { ...x, status: "active" as SkillStatus } : x)),
    }));
  },

  disableSkill: async (id) => {
    await invoke("disable_skill", { id });
    set((s) => ({
      skills: s.skills.map((x) => (x.id === id ? { ...x, status: "disabled" as SkillStatus } : x)),
    }));
  },

  uninstallSkill: async (id) => {
    await invoke("uninstall_skill", { id });
    set((s) => ({ skills: s.skills.filter((x) => x.id !== id) }));
  },

  importFromDir: async (src) => {
    const raw = await invoke("import_skill_from_dir", { src });
    const s = normalizeSkill(raw);
    set((state) => {
      const idx = state.skills.findIndex((x) => x.id === s.id);
      if (idx >= 0) {
        const skills = [...state.skills];
        skills[idx] = s;
        return { skills };
      }
      return { skills: [s, ...state.skills] };
    });
    return s;
  },

  importFromUrl: async (url) => {
    const raw = await invoke("import_skill_from_url", { url });
    const s = normalizeSkill(raw);
    set((state) => {
      const idx = state.skills.findIndex((x) => x.id === s.id);
      if (idx >= 0) {
        const skills = [...state.skills];
        skills[idx] = s;
        return { skills };
      }
      return { skills: [s, ...state.skills] };
    });
    return s;
  },

  importFromGit: async (url) => {
    const raw = await invoke("import_skill_from_git", { url });
    const s = normalizeSkill(raw);
    set((state) => {
      const idx = state.skills.findIndex((x) => x.id === s.id);
      if (idx >= 0) {
        const skills = [...state.skills];
        skills[idx] = s;
        return { skills };
      }
      return { skills: [s, ...state.skills] };
    });
    return s;
  },

  runAudit: async (id) => {
    const raw = await invoke("run_skill_audit", { id });
    const log = normalizeAuditLog(raw);
    set((s) => ({
      skills: s.skills.map((x) => {
        if (x.id !== id) return x;
        const updated = { ...x, riskLevel: log.riskLevel };
        if (log.decision === "rejected") updated.status = "quarantined";
        return updated;
      }),
    }));
    return log;
  },

  getAuditLogs: async (skillId) => {
    const raw = (await invoke("get_skill_audit_logs", { skillId })) as unknown[];
    const auditLogs = raw.map(normalizeAuditLog);
    set({ auditLogs });
    return auditLogs;
  },

  listMarketplace: async (registryUrl) => {
    const raw = (await invoke("list_marketplace_skills", {
      registryUrl: registryUrl ?? null,
    })) as unknown[];
    const marketplaceSkills = raw.map(normalizeMarketplace);
    set({ marketplaceSkills });
    return marketplaceSkills;
  },

  getActiveSkillPrompts: async () => {
    const raw = (await invoke("get_active_skill_prompts")) as unknown[];
    return raw.map((x) => {
      const d = (x ?? {}) as Record<string, unknown>;
      return {
        id: String(d.id ?? ""),
        title: String(d.title ?? ""),
        prompt: String(d.prompt ?? ""),
      };
    });
  },

  executeSkill: async (id, input) => {
    const raw = (await invoke("execute_skill", { id, input })) as Record<string, unknown>;
    return {
      kind: String(raw.kind ?? ""),
      content: String(raw.content ?? ""),
      ready: Boolean(raw.ready),
    };
  },

  getSkillManifest: async (id) => {
    const raw = (await invoke("get_skill_manifest", { id })) as Record<string, unknown>;
    return raw ?? {};
  },

  updateSkillManifest: async (id, patch) => {
    const raw = (await invoke("update_skill_manifest", { id, patch })) as Record<string, unknown>;
    const s = normalizeSkill(raw);
    set((state) => {
      const idx = state.skills.findIndex((x) => x.id === s.id);
      if (idx >= 0) {
        const skills = [...state.skills];
        skills[idx] = s;
        return { skills };
      }
      return { skills: [s, ...state.skills] };
    });
    return s;
  },

  getDefaultSkillPrompts: async () => {
    if (_defaultPromptsInflight) return _defaultPromptsInflight;
    _defaultPromptsInflight = (async () => {
      try {
        const raw = (await invoke("get_default_skill_prompts")) as unknown[];
        const map = new Map<string, string>();
        for (const x of raw) {
          const d = (x ?? {}) as Record<string, unknown>;
          const id = String(d.id ?? "");
          const prompt = String(d.prompt ?? "");
          if (id && prompt) map.set(id, prompt);
        }
        set({ defaultSkillPrompts: map });
        return map;
      } finally {
        _defaultPromptsInflight = null;
      }
    })();
    return _defaultPromptsInflight;
  },
}));
