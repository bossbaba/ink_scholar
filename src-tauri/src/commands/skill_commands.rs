//! 技能中心：本地技能扫描、安装（目录 / URL / Git）、安全审计、市场列表。
//!
//! 设计约束（来自 `docs/技能中心功能规划.md` / `docs/技能中心界面设计.md`）：
//! - 技能目录固定为 `~/Documents/InkScholar/skills/`，每技能一个子目录含 `skill.json`。
//! - 下载 / 导入的技能在启用前**必须**过安全审计（`run_skill_audit`），未授权不得注入 AI。
//! - 审计输出风险评级 P0 / P1 / P2，并写入 `skill_audit_log` 可追溯。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::MutexGuard;
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::Value;
use tauri::{command, AppHandle, Manager, State};

use crate::db::DbConnection;
use crate::models::{
    MarketplaceSkill, Skill, SkillAuditLog, SkillExecResult, SkillPermissions, SkillPrompt,
};

/// 静态扫描最大目录深度（防止恶意极深目录导致扫描挂起）。
const MAX_SCAN_DEPTH: usize = 6;
/// 静态扫描单文件体积上限（超过则跳过，避免大文件全量读入内存）。
const MAX_SCAN_FILE_BYTES: u64 = 1024 * 1024;
/// 导入下载体积上限（防 OOM / 慢源挂起）。
const MAX_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;

/// 技能根目录：`~/Documents/InkScholar/skills`
pub fn skills_dir() -> PathBuf {
    let mut path = dirs::document_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("InkScholar");
    path.push("skills");
    path
}

/// 定位内置默认技能目录（随应用打包的资源目录；`tauri dev` 下回退到仓库 `src-tauri/skills`）。
/// 多候选路径取第一个存在的，兼顾 release（resources/skills）与 dev（不同启动 cwd）。
fn default_skills_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. 打包后的资源目录：bundle.resources 将 `src-tauri/skills` 复制为 `resources/skills`
    if let Ok(rd) = app.path().resource_dir() {
        candidates.push(rd.join("skills"));
    }
    // 2. tauri dev：cwd 通常为项目根目录
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-tauri/skills"));
        candidates.push(cwd.join("resources/skills"));
    }
    // 3. 二进制邻近目录（某些 dev 启动方式 cwd 为 src-tauri）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("skills"));
            if let Some(gp) = parent.parent() {
                candidates.push(gp.join("skills"));
            }
        }
    }

    candidates.into_iter().find(|p| p.is_dir())
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn lock(conn: &DbConnection) -> Result<MutexGuard<'_, Connection>, String> {
    conn.0
        .lock()
        .map_err(|_| "数据库连接锁已被污染".to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// 临时产物清理守卫：析构时尽力删除注册的路径（best-effort，失败仅告警）。
/// 用于导入流程，确保任意退出路径（含错误提前返回）都不会遗留临时 zip / 解压目录 / git 克隆目录。
struct CleanupGuard {
    paths: Vec<PathBuf>,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        for p in &self.paths {
            if !p.exists() {
                continue;
            }
            let res = if p.is_dir() {
                fs::remove_dir_all(p)
            } else {
                fs::remove_file(p)
            };
            if let Err(e) = res {
                tracing::warn!(target: "skill", "临时文件清理失败: {} ({})", p.display(), e);
            }
        }
    }
}

// ==================== 目录遍历 ====================

fn walk_files(dir: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    // 带深度跟踪的遍历：超过 max_depth 的子目录不再下钻，避免恶意极深目录导致挂起。
    let mut stack: Vec<(PathBuf, usize)> = vec![(dir.to_path_buf(), 0)];
    while let Some((d, depth)) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&d) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if depth + 1 < max_depth {
                        stack.push((p, depth + 1));
                    }
                } else {
                    out.push(p);
                }
            }
        }
    }
    out
}

fn find_manifests(dir: &Path) -> Vec<PathBuf> {
    walk_files(dir, MAX_SCAN_DEPTH)
        .into_iter()
        .filter(|p| p.file_name().map(|n| n == "skill.json").unwrap_or(false))
        .collect()
}

/// 在目录树（深度 ≤ 3）中查找首个含 `skill.json` 的目录，返回该目录路径。
fn find_first_skill_root(dir: &Path) -> Option<PathBuf> {
    fn rec(d: &Path, depth: usize) -> Option<PathBuf> {
        if depth == 0 {
            return None;
        }
        if d.join("skill.json").exists() {
            return Some(d.to_path_buf());
        }
        if let Ok(entries) = fs::read_dir(d) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if let Some(r) = rec(&p, depth - 1) {
                        return Some(r);
                    }
                }
            }
        }
        None
    }
    rec(dir, 3)
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取源目录失败: {}", e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        let target = dst.join(entry.file_name());
        if p.is_dir() {
            copy_dir(&p, &target)?;
        } else {
            fs::copy(&p, &target).map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

fn unzip(src: &Path, dst: &Path) -> Result<(), String> {
    let file = fs::File::open(src).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("压缩包损坏: {}", e))?;
    archive
        .extract(dst)
        .map_err(|e| format!("解压失败: {}", e))?;
    Ok(())
}

// ==================== Manifest 解析 ====================

#[derive(Deserialize)]
struct RawManifest {
    name: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    version: String,
    #[serde(rename = "type", default = "default_skill_type")]
    skill_type: String,
    #[serde(default)]
    min_app_version: String,
    #[serde(default)]
    triggers: Vec<String>,
    #[serde(default)]
    entry: Option<Value>,
    #[serde(default)]
    permissions: Option<Value>,
    #[serde(default)]
    security: Option<Value>,
}

fn default_skill_type() -> String {
    "prompt".to_string()
}

/// 解析 `skill.json`，返回 (技能, 声明校验和)。校验和取自 `security.checksum`。
fn parse_manifest_file(path: &Path) -> Result<(Skill, String), String> {
    let content = fs::read_to_string(path).map_err(|e| format!("读取 skill.json 失败: {}", e))?;
    let manifest: RawManifest =
        serde_json::from_str(&content).map_err(|e| format!("skill.json 解析失败: {}", e))?;

    let permissions: SkillPermissions = match manifest.permissions {
        Some(v) => serde_json::from_value(v).unwrap_or_default(),
        None => SkillPermissions::default(),
    };

    let checksum = manifest
        .security
        .as_ref()
        .and_then(|v| v.get("checksum"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    let title = if manifest.title.is_empty() {
        manifest.name.clone()
    } else {
        manifest.title
    };

    let skill = Skill {
        id: manifest.name.clone(),
        name: manifest.name,
        title,
        description: manifest.description,
        author: manifest.author,
        version: manifest.version,
        skill_type: manifest.skill_type,
        source: "local".to_string(),
        status: "disabled".to_string(),
        manifest_path: path.to_string_lossy().to_string(),
        checksum: checksum.clone(),
        signature: String::new(),
        permissions,
        min_app_version: manifest.min_app_version,
        triggers: manifest.triggers,
        risk_level: String::new(),
        installed_at: now(),
        update_available: false,
        is_builtin: false,
    };
    // entry 字段仅用于后续运行时加载，此处不持久化到 DB 行；
    // 若需要可在 skills 表扩展列，本期不引入以保持表结构稳定。
    let _ = manifest.entry;
    Ok((skill, checksum))
}

// ==================== DB 读写 ====================

fn row_to_skill(row: &rusqlite::Row) -> rusqlite::Result<Skill> {
    let permissions_json: String = row.get("permissions_json")?;
    let triggers_json: String = row.get("triggers_json")?;
    let permissions: SkillPermissions =
        serde_json::from_str(&permissions_json).unwrap_or_default();
    let triggers: Vec<String> = serde_json::from_str(&triggers_json).unwrap_or_default();
    let ua: i64 = row.get("update_available")?;
    Ok(Skill {
        id: row.get("id")?,
        name: row.get("name")?,
        title: row.get("title")?,
        description: row.get("description")?,
        author: row.get("author")?,
        version: row.get("version")?,
        skill_type: row.get("skill_type")?,
        source: row.get("source")?,
        status: row.get("status")?,
        manifest_path: row.get("manifest_path")?,
        checksum: row.get("checksum")?,
        signature: row.get("signature")?,
        permissions,
        min_app_version: row.get("min_app_version")?,
        triggers,
        risk_level: row.get("risk_level")?,
        installed_at: row.get("installed_at")?,
        update_available: ua != 0,
        is_builtin: row.get::<_, i64>("is_builtin").unwrap_or(0) != 0,
    })
}

fn upsert_skill(conn: &Connection, s: &Skill) -> Result<(), String> {
    let pj = serde_json::to_string(&s.permissions).unwrap_or_else(|_| "{}".to_string());
    let tj = serde_json::to_string(&s.triggers).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO skills \
         (id,name,title,description,author,version,skill_type,source,status,manifest_path,checksum,signature,permissions_json,min_app_version,triggers_json,risk_level,installed_at,update_available,is_builtin) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19) \
         ON CONFLICT(id) DO UPDATE SET \
         name=?2,title=?3,description=?4,author=?5,version=?6,skill_type=?7,source=?8,status=?9,\
         manifest_path=?10,checksum=?11,signature=?12,permissions_json=?13,min_app_version=?14,\
         triggers_json=?15,risk_level=?16,installed_at=?17,update_available=?18,is_builtin=?19",
        params![
            s.id,
            s.name,
            s.title,
            s.description,
            s.author,
            s.version,
            s.skill_type,
            s.source,
            s.status,
            s.manifest_path,
            s.checksum,
            s.signature,
            pj,
            s.min_app_version,
            tj,
            s.risk_level,
            s.installed_at,
            s.update_available as i64,
            s.is_builtin as i64
        ],
    )
    .map_err(|e| format!("写入技能失败: {}", e))?;
    Ok(())
}

fn select_skill(conn: &Connection, id: &str) -> Option<Skill> {
    conn.query_row("SELECT * FROM skills WHERE id = ?1", params![id], row_to_skill)
        .ok()
}

fn select_all_skills(conn: &Connection) -> Vec<Skill> {
    let mut stmt = match conn.prepare("SELECT * FROM skills ORDER BY installed_at DESC, name ASC") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = match stmt.query_map([], row_to_skill) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for row in rows {
        match row {
            Ok(s) => out.push(s),
            Err(_) => continue,
        }
    }
    out
}

fn insert_audit_log(conn: &Connection, log: &SkillAuditLog) -> Result<(), String> {
    conn.execute(
        "INSERT INTO skill_audit_log (id, skill_id, ran_at, risk_level, findings, decision) \
         VALUES (?1,?2,?3,?4,?5,?6) \
         ON CONFLICT(id) DO UPDATE SET ran_at=?3, risk_level=?4, findings=?5, decision=?6",
        params![
            log.id,
            log.skill_id,
            log.ran_at,
            log.risk_level,
            log.findings,
            log.decision
        ],
    )
    .map_err(|e| format!("写入审计日志失败: {}", e))?;
    Ok(())
}

/// 扫描写入时保留既有启用状态（避免每次扫描把已启用技能重置为 disabled）。
fn upsert_scanned_skill(conn: &Connection, candidate: &Skill) -> Result<(), String> {
    let existing = select_skill(conn, &candidate.id);
    let mut s = candidate.clone();
    if let Some(e) = existing {
        if e.status != "broken" {
            s.status = e.status;
        }
        s.risk_level = e.risk_level;
        s.installed_at = e.installed_at;
        s.update_available = e.update_available;
    }
    upsert_skill(conn, &s)
}

// ==================== 安全审计（静态扫描） ====================

fn contains_any(hay: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| hay.contains(n))
}

/// 对技能目录内所有文件做静态危险能力扫描（best-effort 威慑，**不能替代沙箱执行**）。
/// 返回 (风险评级, 发现列表, 是否含命令执行, 是否含网络, 是否含文件写入, 是否含动态执行)。
///
/// 注意：关键字黑名单可被字符串拼接 / base64 / 大小写变体轻易绕过，本扫描仅作为
/// 启用前的辅助风险提示，真正的信任边界仍由 `enable_skill` 的审计门控保证。
fn static_scan(dir: &Path) -> (String, Vec<String>, bool, bool, bool, bool) {
    let mut findings = Vec::new();
    let mut has_commands = false;
    let mut has_network = false;
    let mut has_fswrite = false;
    let mut has_eval = false;

    for path in walk_files(dir, MAX_SCAN_DEPTH) {
        // 跳过超大文件：只读取体积在阈值内的文件，避免 OOM / 挂起。
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > MAX_SCAN_FILE_BYTES {
                findings.push(format!(
                    "跳过超大文件（>1MB）：{}",
                    path.file_name()
                        .map(|n| n.to_string_lossy())
                        .unwrap_or_default()
                ));
                continue;
            }
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue, // 二进制或不可读，跳过
        };
        let low = content.to_lowercase();

        if contains_any(
            &low,
            &[
                "std::process",
                "command::new",
                "exec(",
                "os/exec",
                "child_process",
                "subprocess",
                "os.system",
                "shell=true",
                "spawn(",
                "popen(",
                "process.start",
                "childprocess",
            ],
        ) {
            has_commands = true;
            findings.push("检测到命令执行能力（commands）".to_string());
        }
        if contains_any(
            &low,
            &[
                "fetch(",
                "http://",
                "https://",
                "reqwest",
                "axios",
                "websocket",
                "tcpstream",
                "net::",
                "http.get",
                "curl ",
                "xmlhttprequest",
            ],
        ) {
            has_network = true;
            findings.push("检测到网络访问能力（network）".to_string());
        }
        if contains_any(
            &low,
            &[
                "fs.writefile",
                "fs::write",
                "remove_file",
                "std::fs::remove",
                "writefilesync",
                "rm -rf",
                "unlink(",
                "fs.unlink",
                "dangerous_write",
            ],
        ) {
            has_fswrite = true;
            findings.push("检测到文件系统写入能力（fs write）".to_string());
        }
        if contains_any(
            &low,
            &[
                "eval(",
                "new function",
                "vm.run",
                "loadmodule",
                "dynamic import",
                "require(",
                "import(",
                "atob(",
                "base64.decode",
            ],
        ) {
            has_eval = true;
            findings.push("检测到动态执行 / 代码加载能力（eval/dynamic）".to_string());
        }
    }

    let mut risk = "P2".to_string();
    if has_commands || (has_fswrite && has_network) || (has_eval && has_network) {
        risk = "P0".to_string();
    } else if has_network || has_fswrite {
        risk = "P1".to_string();
    }
    (risk, findings, has_commands, has_network, has_fswrite, has_eval)
}

// ==================== 命令 ====================

/// 扫描本地技能目录（用户目录），并合并内置默认技能目录（随应用打包），
/// 解析并写入 `skills` 表，返回全部技能。
///
/// 内置技能（位于 `src-tauri/skills`，随应用打包）标记 `is_builtin=true`、来源 `builtin`、
/// 受信低危(P2)，可直接启用而无需通过审计门控；若用户目录存在同名 override，则以其内容为准、
/// 但保留 `is_builtin` 标记（编辑本质是写入用户目录 override）。
#[command]
pub fn scan_local_skills(conn: State<DbConnection>, app: AppHandle) -> Result<Vec<Skill>, String> {
    let mut builtin_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 1. 内置默认技能（随应用打包的资源目录；dev 回退到 src-tauri/skills）
    if let Some(bdir) = default_skills_dir(&app) {
        let manifests = find_manifests(&bdir);
        let guard = lock(&conn)?;
        for m in manifests {
            if let Ok((mut skill, _)) = parse_manifest_file(&m) {
                skill.is_builtin = true;
                skill.source = "builtin".to_string();
                // 受信默认技能，静态扫描亦仅 P2；初始给 P2 使其可直接启用。
                if skill.risk_level.is_empty() {
                    skill.risk_level = "P2".to_string();
                }
                upsert_scanned_skill(&guard, &skill)?;
                builtin_ids.insert(skill.id.clone());
            }
        }
        drop(guard);
    }

    // 2. 用户技能目录（~/Documents/InkScholar/skills）
    let dir = skills_dir();
    if let Err(e) = fs::create_dir_all(&dir) {
        tracing::warn!(target: "skill", "创建技能目录失败: {}", e);
    }
    let manifests = find_manifests(&dir);

    let guard = lock(&conn)?;
    for m in manifests {
        match parse_manifest_file(&m) {
            Ok((mut skill, _)) => {
                // 与内置技能同名 → 视为内置的 override，保留 builtin 标记
                if builtin_ids.contains(&skill.id) {
                    skill.is_builtin = true;
                }
                upsert_scanned_skill(&guard, &skill)?;
            }
            Err(e) => {
                // 以目录名作为稳定 id（而非每次新 uuid），避免解析失败的 broken 记录无限累积。
                let dir_name = m
                    .parent()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "broken-unknown".to_string());
                let id = format!("broken-{}", dir_name);
                let broken = Skill {
                    id: id.clone(),
                    name: id.clone(),
                    title: id,
                    description: format!("解析失败: {}", e),
                    author: String::new(),
                    version: String::new(),
                    skill_type: "prompt".to_string(),
                    source: "local".to_string(),
                    status: "broken".to_string(),
                    manifest_path: m.to_string_lossy().to_string(),
                    checksum: String::new(),
                    signature: String::new(),
                    permissions: SkillPermissions::default(),
                    min_app_version: String::new(),
                    triggers: Vec::new(),
                    risk_level: String::new(),
                    installed_at: now(),
                    update_available: false,
                    is_builtin: false,
                };
                upsert_skill(&guard, &broken)?;
            }
        }
    }
    drop(guard);
    list_skills(conn)
}

/// 列出全部已安装技能。
#[command]
pub fn list_skills(conn: State<DbConnection>) -> Result<Vec<Skill>, String> {
    let guard = lock(&conn)?;
    let all = select_all_skills(&guard);
    drop(guard);
    Ok(all)
}

/// 查询某技能最近一次审计日志（按 ran_at 倒序取第一条）。
fn latest_audit(conn: &Connection, skill_id: &str) -> Option<SkillAuditLog> {
    let mut stmt = conn
        .prepare("SELECT * FROM skill_audit_log WHERE skill_id = ?1 ORDER BY ran_at DESC LIMIT 1")
        .ok()?;
    let mut rows = stmt
        .query_map(params![skill_id], |row| {
            Ok(SkillAuditLog {
                id: row.get("id")?,
                skill_id: row.get("skill_id")?,
                ran_at: row.get("ran_at")?,
                risk_level: row.get("risk_level")?,
                findings: row.get("findings")?,
                decision: row.get("decision")?,
            })
        })
        .ok()?;
    rows.next().and_then(|r| r.ok())
}

/// 启用前的硬性审计门控：安全模型的权威在命令边界，不依赖前端 UI。
/// 要求最近一次审计 `decision == passed` 且评级非 P0；若声明了 checksum 则复校，
/// 防止技能在审计通过后被人篡改。
fn require_passed_audit(conn: &Connection, skill: &Skill) -> Result<(), String> {
    let log = latest_audit(conn, &skill.id)
        .ok_or("请先通过安全审计（在技能详情中运行审计）")?;
    if log.decision != "passed" {
        return Err("技能尚未通过安全审计，无法启用".to_string());
    }
    if log.risk_level == "P0" {
        return Err("技能审计为高危(P0)，禁止启用".to_string());
    }
    if !skill.checksum.is_empty() {
        let manifest_path = Path::new(&skill.manifest_path);
        if let Ok(bytes) = fs::read(manifest_path) {
            let computed = sha256_hex(&bytes);
            if computed != skill.checksum {
                return Err("技能文件校验和已变化，请重新运行审计".to_string());
            }
        }
    }
    Ok(())
}

/// 启用技能（仅非 broken / 非 quarantined 且已通过安全审计可启用）。
#[command]
pub fn enable_skill(conn: State<DbConnection>, id: String) -> Result<(), String> {
    let guard = lock(&conn)?;
    let mut s = select_skill(&guard, &id).ok_or("技能不存在")?;
    if s.status == "broken" {
        return Err("技能解析失败，无法启用".to_string());
    }
    if s.status == "quarantined" {
        return Err("技能处于隔离状态，请先通过安全审计".to_string());
    }
    // 内置默认技能属受信资源，启用无需通过审计门控（与 AI 面板直接可用的边界一致）。
    if !s.is_builtin {
        require_passed_audit(&guard, &s)?;
    }
    s.status = "active".to_string();
    upsert_skill(&guard, &s)?;
    drop(guard);
    Ok(())
}

/// 禁用技能。
#[command]
pub fn disable_skill(conn: State<DbConnection>, id: String) -> Result<(), String> {
    let guard = lock(&conn)?;
    let mut s = select_skill(&guard, &id).ok_or("技能不存在")?;
    s.status = "disabled".to_string();
    upsert_skill(&guard, &s)?;
    drop(guard);
    Ok(())
}

/// 卸载技能：删除目录并从 `skills` 表移除。
#[command]
pub fn uninstall_skill(conn: State<DbConnection>, id: String) -> Result<(), String> {
    let guard = lock(&conn)?;
    let s = select_skill(&guard, &id).ok_or("技能不存在")?;
    if s.is_builtin {
        return Err("内置默认技能不可卸载（可编辑为个人版本）".to_string());
    }
    let skill_dir = Path::new(&s.manifest_path)
        .parent()
        .map(|p| p.to_path_buf());
    drop(guard);

    if let Some(d) = skill_dir {
        if d.exists() {
            fs::remove_dir_all(&d).map_err(|e| format!("删除技能目录失败: {}", e))?;
        }
    }
    let guard = lock(&conn)?;
    guard
        .execute("DELETE FROM skills WHERE id = ?1", params![id])
        .map_err(|e| format!("删除技能记录失败: {}", e))?;
    drop(guard);
    Ok(())
}

/// 把已落盘的技能目录登记进 `skills` 表并返回完整技能记录。
fn install_skill_dir(
    conn: &Connection,
    skill_root: &Path,
    source: &str,
) -> Result<Skill, String> {
    let (mut skill, _) = parse_manifest_file(&skill_root.join("skill.json"))?;
    let base = sanitize(&skill.name);
    let mut target = skills_dir().join(&base);
    if target.exists() {
        target = skills_dir().join(format!(
            "{}-{}",
            base,
            &uuid::Uuid::new_v4().to_string()[..8]
        ));
    }
    copy_dir(skill_root, &target)?;
    skill.source = source.to_string();
    skill.status = "disabled".to_string();
    skill.manifest_path = target.join("skill.json").to_string_lossy().to_string();
    skill.installed_at = now();
    upsert_skill(conn, &skill)?;
    select_skill(conn, &skill.id).ok_or_else(|| "安装后无法读取技能".to_string())
}

/// 校验远程导入 URL：仅允许 http(s)，拦截 file://、ext::、git://、ssh 以及
/// 本地/内网地址，避免仓库/文件协议或内网穿透类向量。
fn validate_remote_url(url: &str) -> Result<(), String> {
    let lower = url.to_lowercase();
    if lower.starts_with("file:")
        || lower.starts_with("ext:")
        || lower.starts_with("git:")
        || lower.starts_with("ssh:")
    {
        return Err("不支持的协议，仅允许 http(s)".to_string());
    }
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("仅允许 http(s) 链接".to_string());
    }
    if lower.contains("localhost")
        || lower.contains("127.0.0.1")
        || lower.contains("0.0.0.0")
        || lower.contains("::1")
        || lower.starts_with("https://192.168.")
        || lower.starts_with("http://192.168.")
        || lower.starts_with("https://10.")
        || lower.starts_with("http://10.")
    {
        return Err("禁止指向本地或内网地址".to_string());
    }
    Ok(())
}

/// 带 30s 超时与 stderr 捕获的 `git clone --depth 1`。
/// macOS 无 GNU `timeout`，故采用 spawn + 看门狗线程（到点先 `kill -0` 探测存活再强杀）的跨平台实现。
fn run_git_clone(url: &str, dest: &Path) -> Result<(), String> {
    let child = Command::new("git")
        .args(["clone", "--depth", "1", url, &dest.to_string_lossy()])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法执行 git（请确认已安装）: {}", e))?;
    let pid = child.id();
    // 看门狗：30s 超时强杀（先探测进程是否仍在，避免误杀被复用的 pid）。
    let _watchdog = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        let alive = std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if alive {
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
        }
    });
    let output = child
        .wait_with_output()
        .map_err(|e| format!("读取 git 输出失败: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "git clone 失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// 从本地目录导入技能（由系统对话框选择文件夹）。
#[command]
pub fn import_skill_from_dir(
    conn: State<DbConnection>,
    src: String,
) -> Result<Skill, String> {
    let src = PathBuf::from(src);
    if !src.is_dir() {
        return Err("源路径不是目录".to_string());
    }
    let root = find_first_skill_root(&src).ok_or("目录内未找到 skill.json")?;
    let guard = lock(&conn)?;
    let skill = install_skill_dir(&guard, &root, "imported")?;
    drop(guard);
    Ok(skill)
}

/// 从 URL 下载 zip 并导入技能。
#[command]
pub async fn import_skill_from_url(
    conn: State<'_, DbConnection>,
    url: String,
) -> Result<Skill, String> {
    // 30s 超时 + 50MB 体积上限，防止恶意/缓慢源挂起或 OOM。
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载技能失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败，HTTP {}", resp.status()));
    }
    if let Some(cl) = resp.content_length() {
        if cl > MAX_DOWNLOAD_BYTES {
            return Err("技能包体积超过上限(50MB)，已拒绝".to_string());
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("技能包体积超过上限(50MB)，已拒绝".to_string());
    }

    let tmp_zip =
        std::env::temp_dir().join(format!("inkscholar_skill_{}.zip", uuid::Uuid::new_v4()));
    let extract_dir =
        std::env::temp_dir().join(format!("inkscholar_skill_{}", uuid::Uuid::new_v4()));
    // 任意退出路径（含错误提前返回）都会触发析构清理临时产物。
    let _guard = CleanupGuard {
        paths: vec![tmp_zip.clone(), extract_dir.clone()],
    };
    fs::write(&tmp_zip, &bytes).map_err(|e| format!("写临时文件失败: {}", e))?;
    fs::create_dir_all(&extract_dir).map_err(|e| format!("创建解压目录失败: {}", e))?;
    unzip(&tmp_zip, &extract_dir)?;

    let root = find_first_skill_root(&extract_dir)
        .ok_or("压缩包内未找到 skill.json（若嵌套超过 3 层暂不支持）")?;
    let guard = lock(&conn)?;
    let skill = install_skill_dir(&guard, &root, "imported")?;
    drop(guard);
    Ok(skill)
}

/// 从 Git 仓库克隆并导入技能。
#[command]
pub async fn import_skill_from_git(
    conn: State<'_, DbConnection>,
    url: String,
) -> Result<Skill, String> {
    // 仅允许 http(s)，拦截 file://、ext::、git://、ssh 以及本地/内网地址。
    validate_remote_url(&url)?;
    let tmp =
        std::env::temp_dir().join(format!("inkscholar_git_{}", uuid::Uuid::new_v4()));
    let _guard = CleanupGuard {
        paths: vec![tmp.clone()],
    };
    run_git_clone(&url, &tmp)?;
    let root = find_first_skill_root(&tmp)
        .ok_or("仓库内未找到 skill.json（若在某子目录暂不支持多层嵌套）")?;
    let guard = lock(&conn)?;
    let skill = install_skill_dir(&guard, &root, "imported")?;
    drop(guard);
    Ok(skill)
}

/// 对指定技能执行安全审计：静态扫描 + 校验和校验 + 风险定级，写入审计日志。
/// 全程持有数据库锁，避免两次取锁之间技能状态被并发改动（TOCTOU）。
#[command]
pub fn run_skill_audit(conn: State<DbConnection>, id: String) -> Result<SkillAuditLog, String> {
    let guard = lock(&conn)?;
    let mut skill = select_skill(&guard, &id).ok_or("技能不存在")?;

    let manifest_path = PathBuf::from(&skill.manifest_path);
    let skill_dir = manifest_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    // 校验和：声明则以声明为准；缺失声明则记录提示，绝不谎称"已验证完整性"。
    let content = fs::read(&manifest_path).unwrap_or_default();
    let computed = sha256_hex(&content);
    let declared = !skill.checksum.is_empty();
    let checksum_ok = !declared || skill.checksum == computed;

    // 静态扫描 + 合并 Manifest 声明权限
    let (mut risk, mut findings, _, _, _, _) = static_scan(&skill_dir);
    if skill.permissions.commands.iter().any(|c| !c.is_empty()) {
        findings.push(format!(
            "声明命令执行权限：{}",
            skill.permissions.commands.join(", ")
        ));
        risk = "P0".to_string();
    }
    if skill.permissions.network {
        findings.push("声明网络访问权限（network）".to_string());
        if risk == "P2" {
            risk = "P1".to_string();
        }
    }
    if skill
        .permissions
        .fs
        .iter()
        .any(|f| f.to_lowercase().contains("write"))
    {
        findings.push(format!(
            "声明文件写入权限：{}",
            skill.permissions.fs.join(", ")
        ));
        if risk == "P2" {
            risk = "P1".to_string();
        }
    }
    if findings.is_empty() {
        findings.push("未检出危险能力，Manifest 校验通过".to_string());
    }

    // 校验和处理
    if declared && !checksum_ok {
        findings.push("校验和(checksum)不匹配，技能可能在传输中被篡改".to_string());
        risk = "P0".to_string();
    } else if !declared {
        findings.push(
            "未声明完整性校验(checksum)，无法验证传输完整性，请确保来源可信".to_string(),
        );
    }

    // 决策：高危(P0) 或校验和不匹配一律拒绝；其余通过（未声明 checksum 时仅提示，仍可通过）。
    let decision = if risk == "P0" || (declared && !checksum_ok) {
        "rejected".to_string()
    } else {
        "passed".to_string()
    };

    let log = SkillAuditLog {
        id: uuid::Uuid::new_v4().to_string(),
        skill_id: id.clone(),
        ran_at: now(),
        risk_level: risk.clone(),
        findings: findings.join("\n"),
        decision: decision.clone(),
    };

    insert_audit_log(&guard, &log)?;
    skill.risk_level = risk.clone();
    if decision == "rejected" {
        skill.status = "quarantined".to_string();
    }
    upsert_skill(&guard, &skill)?;
    drop(guard);
    Ok(log)
}

/// 获取某技能的全部审计日志（时间倒序）。
#[command]
pub fn get_skill_audit_logs(
    conn: State<DbConnection>,
    skill_id: String,
) -> Result<Vec<SkillAuditLog>, String> {
    let guard = lock(&conn)?;
    let logs = {
        let mut stmt = guard
            .prepare("SELECT * FROM skill_audit_log WHERE skill_id = ?1 ORDER BY ran_at DESC")
            .map_err(|e| format!("查询审计日志失败: {}", e))?;
        let rows = stmt
            .query_map(params![skill_id], |row| {
                Ok(SkillAuditLog {
                    id: row.get("id")?,
                    skill_id: row.get("skill_id")?,
                    ran_at: row.get("ran_at")?,
                    risk_level: row.get("risk_level")?,
                    findings: row.get("findings")?,
                    decision: row.get("decision")?,
                })
            })
            .map_err(|e| format!("读取审计日志失败: {}", e))?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(l) => out.push(l),
                Err(_) => continue,
            }
        }
        out
    };
    drop(guard);
    Ok(logs)
}

/// 从官方 Registry 拉取市场技能列表。
/// `registry_url` 为空时返回空列表（前端展示「未配置 Registry」空态）。
#[command]
pub async fn list_marketplace_skills(
    registry_url: Option<String>,
) -> Result<Vec<MarketplaceSkill>, String> {
    let url = match registry_url {
        Some(u) if !u.trim().is_empty() => u,
        _ => return Ok(Vec::new()),
    };
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("请求市场索引失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("市场索引返回 HTTP {}", resp.status()));
    }
    let list: Vec<MarketplaceSkill> = resp
        .json()
        .await
        .map_err(|e| format!("解析市场索引失败: {}", e))?;
    Ok(list)
}

// ==================== 运行时入口（执行层） ====================

/// 运行时读取 `skill.json` 的 `entry` 字段（不落库，避免冗余存储，保持单一来源）。
fn load_entry_json(manifest_path: &str) -> Option<Value> {
    let content = fs::read_to_string(manifest_path).ok()?;
    let v: Value = serde_json::from_str(&content).ok()?;
    v.get("entry").cloned()
}

/// 解析 prompt 类型技能的提示词文本（运行时从 manifest 入口加载）：
/// - `entry` 为字符串 → 直接作为提示词；
/// - `entry` 为对象且含 `prompt` → 取该字段；
/// - `entry` 为对象且含 `file` → 读取该相对路径文件内容。
fn load_prompt_from_manifest(manifest_path: &str) -> Option<String> {
    let entry = load_entry_json(manifest_path)?;
    match entry {
        Value::String(s) => Some(s),
        Value::Object(map) => {
            if let Some(Value::String(p)) = map.get("prompt") {
                return Some(p.clone());
            }
            if let Some(Value::String(f)) = map.get("file") {
                let base = Path::new(manifest_path).parent()?;
                let p = base.join(f);
                return fs::read_to_string(p).ok();
            }
            None
        }
        _ => None,
    }
}

/// 返回所有已启用、允许 AI 调用且为 prompt 类型的技能提示词，
/// 供 AI 面板在发起对话时注入 system 上下文（实现"技能注入 AI"）。
#[command]
pub fn get_active_skill_prompts(
    conn: State<DbConnection>,
) -> Result<Vec<SkillPrompt>, String> {
    let guard = lock(&conn)?;
    let all = select_all_skills(&guard);
    drop(guard);
    let mut out = Vec::new();
    for s in all {
        if s.status != "active" || !s.permissions.ai_invoke || s.skill_type != "prompt" {
            continue;
        }
        if let Some(prompt) = load_prompt_from_manifest(&s.manifest_path) {
            let prompt = prompt.trim().to_string();
            if !prompt.is_empty() {
                out.push(SkillPrompt {
                    id: s.id.clone(),
                    title: s.title.clone(),
                    prompt,
                });
            }
        }
    }
    Ok(out)
}

/// 返回内置默认技能（位于 `src-tauri/skills`，随应用打包）的全部 prompt 类型技能提示词，
/// 供 AI 面板四个 tab（大纲 / 灵感 / 优化 / 续写）在发起对话前注入 system 上下文。
///
/// 与 `get_active_skill_prompts` 的区别：此处只读内置默认技能、不经过启用 / 审计门控——
/// 这些技能是随应用发布的受信内置资源，前端据此直接作为各 tab 的 system prompt 使用，
/// 能力边界与用户从技能中心手动导入的技能一致（纯 prompt、无 fs/network/command）。
#[command]
pub fn get_default_skill_prompts(app: AppHandle) -> Result<Vec<SkillPrompt>, String> {
    use std::collections::HashMap;

    let mut prompts: HashMap<String, SkillPrompt> = HashMap::new();

    // 1. 内置默认技能（随应用打包的资源目录；dev 回退到 src-tauri/skills）作为基础
    if let Some(dir) = default_skills_dir(&app) {
        for m in find_manifests(&dir) {
            if let Ok((skill, _)) = parse_manifest_file(&m) {
                if skill.skill_type != "prompt" {
                    continue;
                }
                if let Some(prompt) = load_prompt_from_manifest(&skill.manifest_path) {
                    let prompt = prompt.trim().to_string();
                    if !prompt.is_empty() {
                        prompts.insert(
                            skill.id.clone(),
                            SkillPrompt {
                                id: skill.id.clone(),
                                title: skill.title.clone(),
                                prompt,
                            },
                        );
                    }
                }
            }
        }
    }

    // 2. 用户目录 override 优先覆盖：与内置默认技能同名 id 的（即内置技能的已编辑版本）
    //    视为 override，保证在技能中心编辑内置技能后，AI 面板能加载到最新版本。
    for m in find_manifests(&skills_dir()) {
        if let Ok((skill, _)) = parse_manifest_file(&m) {
            if skill.skill_type != "prompt" {
                continue;
            }
            // 只覆盖那些与内置默认技能同名 id 的，避免把用户自装技能混入"默认技能"集合
            if !prompts.contains_key(&skill.id) {
                continue;
            }
            if let Some(prompt) = load_prompt_from_manifest(&skill.manifest_path) {
                let prompt = prompt.trim().to_string();
                if !prompt.is_empty() {
                    prompts.insert(
                        skill.id.clone(),
                        SkillPrompt {
                            id: skill.id.clone(),
                            title: skill.title.clone(),
                            prompt,
                        },
                    );
                }
            }
        }
    }

    // 稳定输出顺序，避免每次调用顺序抖动
    let mut out: Vec<SkillPrompt> = prompts.into_values().collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// 读取某技能的完整 manifest（含 `entry`），供「编辑」对话框取初始值。
#[command]
pub fn get_skill_manifest(conn: State<DbConnection>, id: String) -> Result<Value, String> {
    let guard = lock(&conn)?;
    let s = select_skill(&guard, &id).ok_or("技能不存在")?;
    let content = fs::read_to_string(&s.manifest_path)
        .map_err(|e| format!("读取 manifest 失败: {}", e))?;
    drop(guard);
    let v: Value = serde_json::from_str(&content).map_err(|e| format!("manifest 解析失败: {}", e))?;
    Ok(v)
}

#[derive(Deserialize)]
pub struct SkillPatch {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    entry: Option<String>,
    #[serde(default)]
    triggers: Option<Vec<String>>,
}

/// 更新技能 manifest（标题 / 描述 / 触发词 / 提示词文本）。
/// 内置技能写入用户目录 override、保留 `is_builtin` 标记；返回更新后的技能记录。
#[command]
pub fn update_skill_manifest(
    conn: State<DbConnection>,
    id: String,
    patch: SkillPatch,
) -> Result<Skill, String> {
    let guard = lock(&conn)?;
    let s = select_skill(&guard, &id).ok_or("技能不存在")?;
    let is_builtin = s.is_builtin;
    let manifest_path = s.manifest_path.clone();
    let old_status = s.status.clone();
    let old_risk = s.risk_level.clone();
    drop(guard);

    let old_content =
        fs::read_to_string(&manifest_path).map_err(|e| format!("读取 manifest 失败: {}", e))?;
    let mut v: Value =
        serde_json::from_str(&old_content).map_err(|e| format!("manifest 解析失败: {}", e))?;

    if let Some(t) = patch.title {
        v["title"] = Value::String(t);
    }
    if let Some(d) = patch.description {
        v["description"] = Value::String(d);
    }
    if let Some(tr) = patch.triggers {
        v["triggers"] = Value::Array(tr.into_iter().map(Value::String).collect());
    }
    if let Some(en) = patch.entry {
        match v.get("entry") {
            Some(Value::Object(_)) => {
                v["entry"]["prompt"] = Value::String(en);
            }
            _ => {
                v["entry"] = Value::String(en);
            }
        }
    }

    // 内置技能且当前 manifest 在内置（打包 / 仓库）目录 → 写用户目录 override；否则写当前技能目录。
    let user_dir = skills_dir();
    let target_dir = if is_builtin && !Path::new(&manifest_path).starts_with(&user_dir) {
        user_dir.join(sanitize(&id))
    } else {
        Path::new(&manifest_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| user_dir.join(sanitize(&id)))
    };
    fs::create_dir_all(&target_dir).map_err(|e| format!("创建技能目录失败: {}", e))?;
    let target_path = target_dir.join("skill.json");
    let serialized =
        serde_json::to_string_pretty(&v).map_err(|e| format!("序列化 manifest 失败: {}", e))?;
    fs::write(&target_path, serialized).map_err(|e| format!("写入 manifest 失败: {}", e))?;

    let guard = lock(&conn)?;
    let (mut updated, _) = parse_manifest_file(&target_path)?;
    updated.is_builtin = is_builtin; // 保留内置标记
    if updated.status != "broken" {
        updated.status = old_status;
    }
    updated.risk_level = old_risk;
    upsert_skill(&guard, &updated)?;
    drop(guard);
    Ok(updated)
}

/// 执行技能（运行时执行层）。按 `skill_type` 路由：
/// - `prompt`：返回已加载的提示词文本（可注入 AI 对话）；
/// - `tool` / `agent`：登记入口定义但未启用运行时执行引擎（`ready = false`），
///   预留给后续沙箱/编排能力，绝不谎称已执行。
#[command]
pub fn execute_skill(
    conn: State<DbConnection>,
    id: String,
    input: String,
) -> Result<SkillExecResult, String> {
    let guard = lock(&conn)?;
    let s = select_skill(&guard, &id).ok_or("技能不存在")?;
    if s.status != "active" {
        return Err("技能未启用".to_string());
    }
    // L3：permissions.aiInvoke 真正参与门控，不再为死字段。
    if !s.permissions.ai_invoke {
        return Err("该技能未授权 AI 调用（permissions.aiInvoke=false）".to_string());
    }
    drop(guard);

    match s.skill_type.as_str() {
        "prompt" => {
            let prompt = load_prompt_from_manifest(&s.manifest_path).unwrap_or_default();
            Ok(SkillExecResult {
                kind: "prompt".into(),
                content: prompt,
                ready: true,
            })
        }
        "tool" => {
            let entry = load_entry_json(&s.manifest_path)
                .map(|v| v.to_string())
                .unwrap_or_default();
            Ok(SkillExecResult {
                kind: "tool".into(),
                content: format!(
                    "工具类型技能「{}」已在技能中心登记，但运行时执行引擎尚未在当前构建中启用。\n用户指令：{}\n定义：{}",
                    s.title, input, entry
                ),
                ready: false,
            })
        }
        "agent" => {
            let entry = load_entry_json(&s.manifest_path)
                .map(|v| v.to_string())
                .unwrap_or_default();
            Ok(SkillExecResult {
                kind: "agent".into(),
                content: format!(
                    "Agent 工作流技能「{}」已在技能中心登记，但运行时执行引擎尚未在当前构建中启用。\n用户指令：{}\n定义：{}",
                    s.title, input, entry
                ),
                ready: false,
            })
        }
        _ => Err("未知技能类型".to_string()),
    }
}
