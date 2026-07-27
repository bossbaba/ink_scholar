use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};

/// 数据库连接句柄，以 `Mutex` 包裹后作为 Tauri managed state 注入各命令，
/// 保证多线程下对 SQLite 的串行访问。
pub struct DbConnection(pub Mutex<Connection>);

/// 数据库文件路径：`~/Documents/InkScholar/ink_scholar.db`
pub fn db_file_path() -> PathBuf {
    let mut path = dirs::document_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("InkScholar");
    fs::create_dir_all(&path).ok();
    path.push("ink_scholar.db");
    path
}

/// 打开数据库、启用外键约束并执行建表迁移。
pub fn init_db() -> DbConnection {
    let conn = Connection::open(db_file_path()).expect("无法打开 SQLite 数据库");
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .expect("无法启用外键约束 / WAL 模式");
    migrate(&conn);
    DbConnection(Mutex::new(conn))
}

/// 首次启动时创建数据表（幂等）。
pub(crate) fn migrate(conn: &Connection) {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS novels (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            author      TEXT NOT NULL DEFAULT '',
            genre       TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            cover_path  TEXT,
            outline     TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chapters (
            id          TEXT PRIMARY KEY,
            novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
            title       TEXT NOT NULL DEFAULT '',
            content     TEXT NOT NULL DEFAULT '',
            "order"     INTEGER NOT NULL DEFAULT 0,
            word_count  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_chapters_novel_id ON chapters(novel_id);

        CREATE TABLE IF NOT EXISTS chapter_revisions (
            id            TEXT PRIMARY KEY,
            chapter_id   TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
            novel_id     TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
            title         TEXT NOT NULL DEFAULT '',
            content       TEXT NOT NULL DEFAULT '',
            word_count   INTEGER NOT NULL DEFAULT 0,
            revision_index INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rev_chapter_id ON chapter_revisions(chapter_id);

        CREATE TABLE IF NOT EXISTS writing_daily_stats (
            novel_id     TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
            stat_date    TEXT NOT NULL,
            total_words  INTEGER NOT NULL DEFAULT 0,
            chapter_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (novel_id, stat_date)
        );

        CREATE INDEX IF NOT EXISTS idx_daily_date ON writing_daily_stats(stat_date);

        CREATE TABLE IF NOT EXISTS characters (
            id          TEXT PRIMARY KEY,
            novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            identity    TEXT,
            description TEXT,
            color       TEXT NOT NULL DEFAULT '#2FAEFF',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_characters_novel_id ON characters(novel_id);

        CREATE TABLE IF NOT EXISTS character_relations (
            id          TEXT PRIMARY KEY,
            novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
            from_id     TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
            to_id       TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
            category    TEXT NOT NULL DEFAULT 'other',
            label       TEXT,
            description TEXT,
            created_at  TEXT NOT NULL,
            UNIQUE (novel_id, from_id, to_id)
        );

        CREATE INDEX IF NOT EXISTS idx_relations_novel_id ON character_relations(novel_id);

        CREATE TABLE IF NOT EXISTS provider_secrets (
            provider_id   TEXT PRIMARY KEY,
            encrypted_key TEXT NOT NULL,
            nonce         TEXT NOT NULL,
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skills (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            title           TEXT NOT NULL DEFAULT '',
            description     TEXT NOT NULL DEFAULT '',
            author          TEXT NOT NULL DEFAULT '',
            version         TEXT NOT NULL DEFAULT '',
            skill_type      TEXT NOT NULL DEFAULT 'prompt',
            source          TEXT NOT NULL DEFAULT 'local',
            status          TEXT NOT NULL DEFAULT 'disabled',
            manifest_path   TEXT NOT NULL DEFAULT '',
            checksum        TEXT NOT NULL DEFAULT '',
            signature       TEXT NOT NULL DEFAULT '',
            permissions_json TEXT NOT NULL DEFAULT '{}',
            min_app_version TEXT NOT NULL DEFAULT '',
            triggers_json   TEXT NOT NULL DEFAULT '[]',
            risk_level      TEXT NOT NULL DEFAULT '',
            installed_at    TEXT NOT NULL DEFAULT '',
            update_available INTEGER NOT NULL DEFAULT 0,
            is_builtin      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS skill_audit_log (
            id          TEXT PRIMARY KEY,
            skill_id    TEXT NOT NULL,
            ran_at      TEXT NOT NULL,
            risk_level  TEXT NOT NULL DEFAULT '',
            findings    TEXT NOT NULL DEFAULT '',
            decision    TEXT NOT NULL DEFAULT ''
        );
        "#,
    )
        .expect("数据库迁移失败");

    // 旧库升级：skills 表补 is_builtin 列（幂等，忽略"列已存在"错误）。
    if let Err(e) = conn.execute(
        "ALTER TABLE skills ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0",
        [],
    ) {
        let msg = e.to_string();
        if !msg.contains("duplicate column") && !msg.contains("already exists") {
            panic!("迁移 skills.is_builtin 失败: {}", msg);
        }
    }

    // 为已存在（升级前）的小说补一条以 updated_at 当日为准的快照，
    // 让升级后的趋势图不至于完全空白（之后的保存会自动续写）。
    seed_writing_stats(conn);

    // 旧版角色关系表使用 `relation_type` 列，新版改为 `category` + `label`。
    // 幂等：仅当 `category` 列不存在时执行结构迁移。
    migrate_character_relations_schema(conn).expect("角色关系迁移失败");
}

/// 旧库升级时，为尚无日快照的小说补一份初始快照：
/// 以该本 `updated_at` 的日期为 `stat_date`，字数与章节数取当前实值。
/// 幂等：已存在同日期行则 `INSERT OR IGNORE` 跳过。
/// 检测 `character_relations` 是否为旧版结构（缺少 `category` / `created_at` 列
/// 或缺少 `(novel_id, from_id, to_id)` 唯一约束），必要时迁移数据到新表。
/// 幂等：结构已正确时直接跳过。
fn migrate_character_relations_schema(conn: &Connection) -> Result<(), String> {
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(character_relations)")
        .and_then(|mut stmt| {
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();

    // 检查目标唯一约束是否存在（SQLite 自动为 UNIQUE 创建索引，可能是 sqlite_autoindex_*）。
    let has_unique = conn
        .prepare("PRAGMA index_list(character_relations)")
        .and_then(|mut stmt| {
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i32>(2)?)) // (name, unique)
            })?;
            rows.collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, unique)| *unique == 1)
        .any(|(name, _)| {
            conn.prepare(&format!("PRAGMA index_info({})", name))
                .and_then(|mut stmt| {
                    let rows = stmt.query_map([], |row| row.get::<_, String>(2))?; // column name
                    rows.collect::<Result<Vec<_>, _>>()
                })
                .unwrap_or_default()
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .windows(3)
                .any(|w| w == ["novel_id", "from_id", "to_id"])
        });

    let needs_rebuild = !cols.contains(&"category".to_string())
        || !cols.contains(&"created_at".to_string())
        || !has_unique;

    if !needs_rebuild {
        return Ok(());
    }

    // 若只是缺 created_at 且已有唯一约束，走轻量 ALTER。
    if cols.contains(&"category".to_string()) && has_unique && !cols.contains(&"created_at".to_string()) {
        conn.execute(
            "ALTER TABLE character_relations ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))",
            [],
        )
        .map_err(|e| format!("补全 character_relations.created_at 列失败: {}", e))?;
        return Ok(());
    }

    // 表结构差异较大：重建表并迁移数据（不关闭外键，INSERT OR IGNORE 可跳过孤儿行）。
    // 用事务包裹，避免 DROP 成功而 RENAME 失败时数据丢失，使迁移成为原子操作。
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开启角色关系迁移事务失败: {}", e))?;
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS character_relations_new (
            id          TEXT PRIMARY KEY,
            novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
            from_id     TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
            to_id       TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
            category    TEXT NOT NULL DEFAULT 'other',
            label       TEXT,
            description TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (novel_id, from_id, to_id)
        );

        INSERT OR IGNORE INTO character_relations_new
            (id, novel_id, from_id, to_id, category, label, description, created_at)
        SELECT
            COALESCE(id, lower(hex(randomblob(16)))),
            novel_id,
            from_id,
            to_id,
            COALESCE(category, relation_type, 'other'),
            label,
            description,
            COALESCE(created_at, datetime('now'))
        FROM character_relations;

        DROP TABLE character_relations;
        ALTER TABLE character_relations_new RENAME TO character_relations;

        CREATE INDEX IF NOT EXISTS idx_relations_novel_id ON character_relations(novel_id);
        "#,
    )
    .map_err(|e| format!("重建 character_relations 表失败: {}", e))?;
    tx.commit()
        .map_err(|e| format!("提交角色关系迁移事务失败: {}", e))?;
    Ok(())
}

fn seed_writing_stats(conn: &Connection) {
    let novels = conn
        .query_row("SELECT COUNT(*) FROM novels", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0);
    if novels == 0 {
        return;
    }
    let mut stmt = conn
        .prepare("SELECT id, updated_at FROM novels")
        .expect("无法查询 novels");
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .expect("无法遍历 novels")
        .map(|r| r.expect("读取 novel 行失败"))
        .collect::<Vec<(String, String)>>();

    for (id, updated_at) in rows {
        let date = updated_at.get(0..10).unwrap_or("1970-01-01").to_string();
        let total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE novel_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chapters WHERE novel_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            "INSERT OR IGNORE INTO writing_daily_stats (novel_id, stat_date, total_words, chapter_count)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, date, total, cnt],
        )
        .ok();
    }
}
