use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// 兼容 `installs` 字段既可能为字符串也可能为数字（不同 Registry 实现不一致）。
fn flexible_string<'de, D>(d: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum {
        S(String),
        N(u64),
    }
    match StrOrNum::deserialize(d)? {
        StrOrNum::S(s) => Ok(s),
        StrOrNum::N(n) => Ok(n.to_string()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelProject {
    pub id: String,
    pub title: String,
    pub author: String,
    pub genre: String,
    pub description: String,
    pub cover_path: Option<String>,
    pub chapters: Vec<Chapter>,
    pub outline: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    /// 章节正文。为支持「打开小说不读全量正文」的懒加载优化，
    /// `open_novel` 返回的章节此字段为空串且 `content_loaded = false`，
    /// 需前端调用 `load_chapter_content` 按需加载后才有值。
    pub content: String,
    /// 标记 `content` 是否已从数据库加载。前端保存时需据此判断：
    /// 未加载的章节不应以其空 content 覆盖数据库中已有正文（防数据丢失）。
    pub content_loaded: bool,
    pub order: usize,
    pub word_count: usize,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 章节的历史版本快照。每次章节内容发生变更（或新章节首次保存）时，
/// 由 `archive_revision` 写入一条记录，供用户事后查看与恢复。
/// 同一章节的多个版本按 `revision_index` 升序排列，数值越大越新。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRevision {
    pub id: String,
    pub chapter_id: String,
    pub novel_id: String,
    pub title: String,
    pub content: String,
    pub word_count: usize,
    pub revision_index: usize,
    pub created_at: DateTime<Utc>,
}

/// 某本小说在指定日期的累计写作快照。
/// 每次保存（`upsert_novel`）后按当天日期 upsert 一行，
/// 用于绘制「总字数趋势」与统计「写作活跃天数 / 连续天数」。
/// 同一本小说一天只有一行（`novel_id + stat_date` 唯一），自动保存不会刷屏。
/// 角色（人物）。属于某一本小说（`novel_id` 外键级联），
/// 是关系图谱的节点。`identity` 为身份定位（如「主角 / 反派」），
/// 值为「主角」时在画布中作为环形布局的中心节点。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: String,
    pub novel_id: String,
    pub name: String,
    pub identity: Option<String>,
    pub description: Option<String>,
    /// 头像标签色（hex），默认取品牌蓝 #2FAEFF
    pub color: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 角色关系（图谱边）。有方向（`from_id` → `to_id`），
/// `category` 决定颜色与分组（emotion/blood/mentor/enemy/other）。
/// 同一对角色之间只允许一条边（`(novel_id, from_id, to_id)` 唯一约束）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterRelation {
    pub id: String,
    pub novel_id: String,
    pub from_id: String,
    pub to_id: String,
    pub category: String,
    pub label: Option<String>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingDailyStat {
    pub novel_id: String,
    /// 本地时区日期，格式 `YYYY-MM-DD`
    pub stat_date: String,
    /// 截至该日该本（或全部作品聚合）的累计总字数
    pub total_words: usize,
    /// 截至该日该本（或全部作品聚合）的章节数
    pub chapter_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelMetadata {
    pub id: String,
    pub title: String,
    pub author: String,
    pub genre: String,
    pub description: String,
    pub cover_path: Option<String>,
    pub chapter_count: usize,
    pub total_word_count: usize,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl NovelProject {
    pub fn new(title: String, author: String, genre: String, description: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            title,
            author,
            genre,
            description,
            cover_path: None,
            chapters: Vec::new(),
            outline: None,
            created_at: now,
            updated_at: now,
        }
    }
}

/// 技能请求的权限集合（最小化原则：仅声明 Manifest 中列出的项）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPermissions {
    /// 文件系统能力范围，如 ["read:novel", "read:chapter", "write:workspace"]
    #[serde(default)]
    pub fs: Vec<String>,
    /// 是否允许访问网络
    #[serde(default)]
    pub network: bool,
    /// 允许执行的命令白名单（非空即高危）
    #[serde(default)]
    pub commands: Vec<String>,
    /// 是否允许被 AI 调用（注入提示词 / 注册工具）
    #[serde(default)]
    pub ai_invoke: bool,
}

impl Default for SkillPermissions {
    fn default() -> Self {
        Self {
            fs: Vec::new(),
            network: false,
            commands: Vec::new(),
            ai_invoke: true,
        }
    }
}

/// 已安装技能（skills 表的行，经 DB 读回后的结构化表示）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub version: String,
    /// prompt | tool | agent
    pub skill_type: String,
    /// local | market | imported
    pub source: String,
    /// active | disabled | quarantined | broken
    pub status: String,
    pub manifest_path: String,
    pub checksum: String,
    pub signature: String,
    pub permissions: SkillPermissions,
    pub min_app_version: String,
    #[serde(default)]
    pub triggers: Vec<String>,
    /// P0 | P1 | P2（最近一次审计评级）
    pub risk_level: String,
    pub installed_at: String,
    #[serde(default)]
    pub update_available: bool,
    /// 是否随应用内置的默认技能。内置技能不可卸载，但可编辑（编辑内容写入用户目录 override）。
    #[serde(default)]
    pub is_builtin: bool,
}

/// 技能安全审计日志（skill_audit_log 表的行）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAuditLog {
    pub id: String,
    pub skill_id: String,
    pub ran_at: String,
    /// P0 | P1 | P2
    pub risk_level: String,
    /// 审计发现（人类可读，多行以 \n 分隔）
    pub findings: String,
    /// passed | rejected | pending
    pub decision: String,
}

/// 市场技能摘要（官方 Registry 索引项的客户端镜像）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSkill {
    pub id: String,
    pub name: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub skill_type: String,
    pub risk_level: String,
    #[serde(default, deserialize_with = "flexible_string")]
    pub installs: String,
    pub download_url: String,
    #[serde(default)]
    pub checksum: String,
    pub permissions: SkillPermissions,
}

/// 已启用 prompt 技能回传给 AI 面板的提示词片段，用于对话时自动注入 system 上下文。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPrompt {
    pub id: String,
    pub title: String,
    pub prompt: String,
}

/// `execute_skill` 的执行结果。运行时执行引擎目前仅完整支持 `prompt` 类型；
/// `tool` / `agent` 类型已登记入口定义但执行引擎尚未在当前构建中启用（`ready = false`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExecResult {
    /// prompt | tool | agent
    pub kind: String,
    pub content: String,
    /// 是否已在当前构建中具备运行时执行能力
    pub ready: bool,
}
