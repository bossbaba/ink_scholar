use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use tauri::State;
use tracing::warn;
use uuid::Uuid;

use crate::db::DbConnection;
use crate::models::novel::{
    Character, CharacterRelation, Chapter, ChapterRevision, NovelMetadata, NovelProject,
    WritingDailyStat,
};

/// 将 RFC3339 字符串解析回 `DateTime<Utc>`，用于从数据库读取时间字段。
///
/// 防御性解析：时间字段理论上由本程序以 `Utc::now().to_rfc3339()` 写入，
/// 不会脏；但若数据库文件被外部工具篡改或版本迁移产生异常值，单条脏数据
/// 不应拖垮整个列表/详情查询。解析失败时记录警告并以当前时间兜底，
/// 保证查询总能返回其余正常记录。
fn parse_dt(value: String) -> DateTime<Utc> {
    match DateTime::parse_from_rfc3339(&value) {
        Ok(dt) => dt.with_timezone(&Utc),
        Err(e) => {
            warn!("[parse_dt] 无法解析时间字段 `{}`: {}", value, e);
            Utc::now()
        }
    }
}

/// 锁定数据库连接，返回 `Connection` 守卫。
/// 若此前发生过 panic 导致 `Mutex` 中毒，这里不整体报错，而是取回内部守卫继续工作，
/// 避免单个命令 panic 就让整个数据库永久瘫痪。
pub(crate) fn lock_db(
    db: &DbConnection,
) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    match db.0.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => Ok(poisoned.into_inner()),
    }
}

// ============ 内部数据访问辅助（接收 &Connection，同步执行） ============

/// 为某一章节存一份内容快照（版本历史）。
///
/// 幂等：若该章节最新一份 revision 的内容与 `content` 相同，则跳过，
/// 避免自动保存等高频场景下产生大量重复存档。
/// 每章节最多保留 `MAX_REVISIONS` 份（50），超出则删除最旧的若干份。
fn archive_revision(
    conn: &Connection,
    novel_id: &str,
    chapter_id: &str,
    title: &str,
    content: &str,
    word_count: usize,
) -> Result<(), String> {
    // 取该章节最新一份 revision 的内容，与上版相同则跳过
    let last_content: Option<String> = conn
        .query_row(
            "SELECT content FROM chapter_revisions WHERE chapter_id = ?1 ORDER BY revision_index DESC LIMIT 1",
            params![chapter_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    if let Some(ref last) = last_content {
        if last == content {
            return Ok(());
        }
    }

    // 新版本序号 = 当前最大序号 + 1（无记录则从 0 起）
    let max_idx: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(revision_index), -1) FROM chapter_revisions WHERE chapter_id = ?1",
            params![chapter_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let new_idx = (max_idx + 1) as usize;

    let now = Utc::now();
    conn.execute(
        "INSERT INTO chapter_revisions (id, chapter_id, novel_id, title, content, word_count, revision_index, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            Uuid::new_v4().to_string(),
            chapter_id,
            novel_id,
            title,
            content,
            word_count as i64,
            new_idx as i64,
            now.to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;

    // 清洁：超出上限则删除最旧的版本
    const MAX_REVISIONS: i64 = 50;
    conn.execute(
        "DELETE FROM chapter_revisions
         WHERE chapter_id = ?1
           AND revision_index <= (
             SELECT MAX(revision_index) - ?2 FROM chapter_revisions WHERE chapter_id = ?1
           )",
        params![chapter_id, MAX_REVISIONS],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 插入或更新一本小说及其全部章节（先删后插章节，简单可靠）。
/// 增量保存一本小说：
/// - novels 元数据始终 upsert（代价低）；
/// - chapters 按 id 逐章比对：新章节 INSERT、变更章节 UPDATE（保留未变章节的 created_at）、
///   已不存在的章节 DELETE。避免每次自动保存全量重写所有章节。
/// 整个流程包在事务里，保证原子性。
fn upsert_novel(conn: &Connection, novel: &NovelProject) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开启事务失败: {}", e))?;

    tx.execute(
        "INSERT INTO novels (id, title, author, genre, description, cover_path, outline, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            title       = excluded.title,
            author      = excluded.author,
            genre       = excluded.genre,
            description = excluded.description,
            cover_path  = COALESCE(excluded.cover_path, novels.cover_path),
            outline     = excluded.outline,
            updated_at  = excluded.updated_at",
        params![
            novel.id,
            novel.title,
            novel.author,
            novel.genre,
            novel.description,
            novel.cover_path,
            novel.outline,
            novel.created_at.to_rfc3339(),
            novel.updated_at.to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;

    // 读取已有章节（id, title, content, order, word_count），收集后立即释放 Statement 借用
    let existing: Vec<(String, String, String, i64, i64)> = {
        let mut estmt = tx
            .prepare("SELECT id, title, content, \"order\", word_count FROM chapters WHERE novel_id = ?1")
            .map_err(|e| e.to_string())?;
        // 绑到独立局部变量，使 query_map 的临时借用在该语句结束时析构，早于 estmt 的 drop
        let collected = estmt
            .query_map(params![novel.id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        collected
    };

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for chapter in &novel.chapters {
        let order = chapter.order as i64;
        seen.insert(chapter.id.clone());

        match existing.iter().find(|e| e.0 == chapter.id) {
            // 已存在：标题/顺序或已加载的正文变更时才 UPDATE。
            // 未加载正文的章节（content_loaded=false，即打开小说时未读入的章节）不得用其空 content
            // 覆盖数据库里已有正文，否则会在保存时静默丢失内容。
            Some(ex) => {
                // 仅当 content 已加载时才比较正文；未加载时沿用数据库原正文
                let effective_content = if chapter.content_loaded {
                    chapter.content.clone()
                } else {
                    ex.2.clone()
                };
                let content_changed = chapter.content_loaded && ex.2 != chapter.content;
                let changed = ex.1 != chapter.title || content_changed || ex.3 != order;
                if changed {
                    tx.execute(
                        "UPDATE chapters SET title = ?1, content = ?2, \"order\" = ?3, word_count = ?4, updated_at = ?5
                         WHERE id = ?6 AND novel_id = ?7",
                        params![
                            chapter.title,
                            effective_content,
                            order,
                            chapter.word_count as i64,
                            Utc::now().to_rfc3339(),
                            chapter.id,
                            novel.id,
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    // 仅正文实际变更时存档新版本快照
                    if content_changed {
                        archive_revision(
                            &tx,
                            &novel.id,
                            &chapter.id,
                            &chapter.title,
                            &effective_content,
                            chapter.word_count,
                        )?;
                    }
                }
            }
            // 新章节：INSERT
            None => {
                tx.execute(
                    "INSERT INTO chapters (id, novel_id, title, content, \"order\", word_count, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        chapter.id,
                        novel.id,
                        chapter.title,
                        chapter.content,
                        order,
                        chapter.word_count as i64,
                        chapter.created_at.to_rfc3339(),
                        Utc::now().to_rfc3339(),
                    ],
                )
                .map_err(|e| e.to_string())?;
                // 新章节首次保存：存档初版快照
                archive_revision(
                    &tx,
                    &novel.id,
                    &chapter.id,
                    &chapter.title,
                    &chapter.content,
                    chapter.word_count,
                )?;
            }
        }
    }

    // 删除前端已不存在的章节
    for ex in &existing {
        if !seen.contains(&ex.0) {
            tx.execute(
                "DELETE FROM chapters WHERE id = ?1 AND novel_id = ?2",
                params![ex.0, novel.id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| format!("提交事务失败: {}", e))?;

    // 保存成功后，按当天日期 upsert 一条累计快照，供「写作统计」趋势图使用。
    record_daily_stat(conn, &novel.id)?;

    Ok(())
}

/// 记录（或刷新）某本小说在「今天」的累计字数 / 章节数快照。
///
/// 以 `(novel_id, stat_date)` 为主键，`ON CONFLICT` 时覆盖同日旧值，
/// 因此一天内的多次自动保存只会留一行，不会刷屏。
fn record_daily_stat(conn: &Connection, novel_id: &str) -> Result<(), String> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE novel_id = ?1",
            params![novel_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let cnt: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE novel_id = ?1",
            params![novel_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO writing_daily_stats (novel_id, stat_date, total_words, chapter_count)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(novel_id, stat_date) DO UPDATE SET
            total_words   = excluded.total_words,
            chapter_count = excluded.chapter_count",
        params![novel_id, today, total, cnt],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 从数据库加载一本小说（含其章节，按 order 升序）。
pub(crate) fn load_novel(conn: &Connection, novel_id: &str) -> Result<NovelProject, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, author, genre, description, cover_path, outline, created_at, updated_at
             FROM novels WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let novel = stmt
        .query_row(params![novel_id], |row| {
            Ok(NovelProject {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                genre: row.get(3)?,
                description: row.get(4)?,
                cover_path: row.get(5)?,
                outline: row.get(6)?,
                created_at: parse_dt(row.get::<_, String>(7)?),
                updated_at: parse_dt(row.get::<_, String>(8)?),
                chapters: Vec::new(),
            })
        })
        .map_err(|_| "Novel not found".to_string())?;

    let mut cstmt = conn
        .prepare(
            // 懒加载优化（MD-17）：打开小说时只加载章节元数据（不含正文 content），
            // 正文由前端在打开具体章节时按需调用 `load_chapter_content` 获取。
            "SELECT id, title, \"order\", word_count, created_at, updated_at
             FROM chapters WHERE novel_id = ?1 ORDER BY \"order\" ASC",
        )
        .map_err(|e| e.to_string())?;

    let chapters = cstmt
        .query_map(params![novel_id], |row| {
            Ok(Chapter {
                id: row.get(0)?,
                title: row.get(1)?,
                content: String::new(),
                content_loaded: false,
                order: row.get::<_, i64>(2)? as usize,
                word_count: row.get::<_, i64>(3)? as usize,
                created_at: parse_dt(row.get::<_, String>(4)?),
                updated_at: parse_dt(row.get::<_, String>(5)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut novel = novel;
    novel.chapters = chapters;
    Ok(novel)
}

// ============ Tauri 命令（签名与前端调用保持一致） ============

#[tauri::command]
pub fn create_novel(
    db: State<DbConnection>,
    title: String,
    author: String,
    genre: String,
    description: String,
) -> Result<NovelProject, String> {
    let novel = NovelProject::new(title, author, genre, description);
    let conn = lock_db(&db)?;
    upsert_novel(&conn, &novel)?;
    Ok(novel)
}

#[tauri::command]
pub fn open_novel(db: State<DbConnection>, novel_id: String) -> Result<NovelProject, String> {
    let conn = lock_db(&db)?;
    load_novel(&conn, &novel_id)
}

/// 从数据库读取单章正文，并校验章节归属本小说（防止越权读取其他作品的章节正文）。
/// 供 Tauri 命令 `load_chapter_content` 与导出命令（需补全正文）复用。
pub(crate) fn read_chapter_content(
    conn: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<String, String> {
    conn.query_row(
        "SELECT c.content FROM chapters c WHERE c.id = ?1 AND c.novel_id = ?2",
        params![chapter_id, novel_id],
        |row| row.get(0),
    )
    .map_err(|_| "Chapter not found in this novel".to_string())
}

/// 按需加载单章正文（懒加载，MD-17）。`open_novel` 不再返回全量正文，
/// 前端在打开/切换到具体章节时调用本命令获取该章 content。
#[tauri::command]
pub fn load_chapter_content(
    db: State<DbConnection>,
    novel_id: String,
    chapter_id: String,
) -> Result<String, String> {
    let conn = lock_db(&db)?;
    read_chapter_content(&conn, &novel_id, &chapter_id)
}

#[tauri::command]
pub fn save_novel(db: State<DbConnection>, novel: NovelProject) -> Result<(), String> {
    let conn = lock_db(&db)?;
    upsert_novel(&conn, &novel)
}

#[tauri::command]
pub fn delete_novel(db: State<DbConnection>, novel_id: String) -> Result<(), String> {
    let conn = lock_db(&db)?;
    conn.execute("DELETE FROM novels WHERE id = ?1", params![novel_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_novels(db: State<DbConnection>) -> Result<Vec<NovelMetadata>, String> {
    let conn = lock_db(&db)?;
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.title, n.author, n.genre, n.description, n.cover_path,
                    n.created_at, n.updated_at,
                    COUNT(c.id) AS chapter_count,
                    COALESCE(SUM(c.word_count), 0) AS total_word_count
             FROM novels n
             LEFT JOIN chapters c ON c.novel_id = n.id
             GROUP BY n.id
             ORDER BY n.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let novels = stmt
        .query_map([], |row| {
            Ok(NovelMetadata {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                genre: row.get(3)?,
                description: row.get(4)?,
                cover_path: row.get(5)?,
                created_at: parse_dt(row.get::<_, String>(6)?),
                updated_at: parse_dt(row.get::<_, String>(7)?),
                chapter_count: row.get::<_, i64>(8)? as usize,
                total_word_count: row.get::<_, i64>(9)? as usize,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(novels)
}

#[tauri::command]
pub fn add_chapter(
    db: State<DbConnection>,
    novel_id: String,
    title: String,
) -> Result<Chapter, String> {
    let conn = lock_db(&db)?;
    let novel = load_novel(&conn, &novel_id)?;
    let now = Utc::now();
    let chapter = Chapter {
        id: Uuid::new_v4().to_string(),
        title,
        content: String::new(),
        content_loaded: true,
        order: novel.chapters.len(),
        word_count: 0,
        created_at: now,
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO chapters (id, novel_id, title, content, \"order\", word_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            chapter.id,
            novel_id,
            chapter.title,
            chapter.content,
            chapter.order as i64,
            chapter.word_count as i64,
            chapter.created_at.to_rfc3339(),
            chapter.updated_at.to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE novels SET updated_at = ?1 WHERE id = ?2",
        params![now.to_rfc3339(), novel_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(chapter)
}

#[tauri::command]
pub fn delete_chapter(
    db: State<DbConnection>,
    novel_id: String,
    chapter_id: String,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    conn.execute(
        "DELETE FROM chapters WHERE id = ?1 AND novel_id = ?2",
        params![chapter_id, novel_id],
    )
    .map_err(|e| e.to_string())?;

    // 重排剩余章节的 order：用单条语句，按原 order 升序为每章重新计算连续序号（0..n-1），
    // 避免逐章 UPDATE，减少写操作次数。相关子查询在 SQLite 中使用更新前的旧 order 计算，结果正确。
    conn.execute(
        "UPDATE chapters SET \"order\" = (
            SELECT COUNT(*) FROM chapters AS c2
            WHERE c2.novel_id = chapters.novel_id
              AND c2.\"order\" < chapters.\"order\"
        ) WHERE novel_id = ?1",
        params![novel_id],
    )
    .map_err(|e| e.to_string())?;
    let now = Utc::now();
    conn.execute(
        "UPDATE novels SET updated_at = ?1 WHERE id = ?2",
        params![now.to_rfc3339(), novel_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reorder_chapters(
    db: State<DbConnection>,
    novel_id: String,
    chapter_ids: Vec<String>,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    for (index, id) in chapter_ids.iter().enumerate() {
        conn.execute(
            "UPDATE chapters SET \"order\" = ?1 WHERE id = ?2 AND novel_id = ?3",
            params![index as i64, id, novel_id],
        )
        .map_err(|e| e.to_string())?;
    }
    let now = Utc::now();
    conn.execute(
        "UPDATE novels SET updated_at = ?1 WHERE id = ?2",
        params![now.to_rfc3339(), novel_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rename_chapter(
    db: State<DbConnection>,
    novel_id: String,
    chapter_id: String,
    new_title: String,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    let affected = conn.execute(
        "UPDATE chapters SET title = ?1, updated_at = ?2 WHERE id = ?3 AND novel_id = ?4",
        params![new_title, Utc::now().to_rfc3339(), chapter_id, novel_id],
    )
    .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("Chapter not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn update_novel_metadata(
    db: State<DbConnection>,
    novel_id: String,
    title: Option<String>,
    author: Option<String>,
    genre: Option<String>,
    description: Option<String>,
    cover_path: Option<String>,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    let novel = load_novel(&conn, &novel_id)?;
    let new_title = title.unwrap_or(novel.title);
    let new_author = author.unwrap_or(novel.author);
    let new_genre = genre.unwrap_or(novel.genre);
    let new_description = description.unwrap_or(novel.description);
    let new_cover = cover_path.or(novel.cover_path);
    conn.execute(
        "UPDATE novels SET title = ?1, author = ?2, genre = ?3, description = ?4, cover_path = ?5, updated_at = ?6
         WHERE id = ?7",
        params![
            new_title,
            new_author,
            new_genre,
            new_description,
            new_cover,
            Utc::now().to_rfc3339(),
            novel_id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ============ 章节版本历史（内部 fn + Tauri 命令） ============

/// 读取某章节的全部历史版本（按 `revision_index` 降序，最新在前）。
fn list_chapter_revisions_inner(
    conn: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<Vec<ChapterRevision>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, chapter_id, novel_id, title, content, word_count, revision_index, created_at
             FROM chapter_revisions WHERE novel_id = ?1 AND chapter_id = ?2 ORDER BY revision_index DESC",
        )
        .map_err(|e| e.to_string())?;

    let revs = stmt
        .query_map(params![novel_id, chapter_id], |row| {
            Ok(ChapterRevision {
                id: row.get(0)?,
                chapter_id: row.get(1)?,
                novel_id: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                word_count: row.get::<_, i64>(5)? as usize,
                revision_index: row.get::<_, i64>(6)? as usize,
                created_at: parse_dt(row.get::<_, String>(7)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(revs)
}

/// 读取单条版本快照详情（按 `id` + `novel_id` 联合过滤，防止越权读取其他作品的快照）。
fn get_chapter_revision_inner(
    conn: &Connection,
    novel_id: &str,
    revision_id: &str,
) -> Result<ChapterRevision, String> {
    let rev = conn
        .query_row(
            "SELECT id, chapter_id, novel_id, title, content, word_count, revision_index, created_at
             FROM chapter_revisions WHERE id = ?1 AND novel_id = ?2",
            params![revision_id, novel_id],
            |row| {
                Ok(ChapterRevision {
                    id: row.get(0)?,
                    chapter_id: row.get(1)?,
                    novel_id: row.get(2)?,
                    title: row.get(3)?,
                    content: row.get(4)?,
                    word_count: row.get::<_, i64>(5)? as usize,
                    revision_index: row.get::<_, i64>(6)? as usize,
                    created_at: parse_dt(row.get::<_, String>(7)?),
                })
            },
        )
        .map_err(|_| "Revision not found".to_string())?;
    Ok(rev)
}

/// 将某章节恢复到指定历史版本的内容，返回更新后的章节。
/// 恢复操作本身**不**再写一份 revision，避免污染历史；用户在恢复后
/// 再次保存时，新内容会作为正常版本存档。
fn restore_chapter_inner(
    conn: &Connection,
    novel_id: &str,
    chapter_id: &str,
    revision_id: &str,
) -> Result<Chapter, String> {
    let rev = get_chapter_revision_inner(conn, novel_id, revision_id)?;
    if rev.chapter_id != chapter_id || rev.novel_id != novel_id {
        return Err("该版本不属于当前章节".to_string());
    }
    let now = Utc::now();
    conn.execute(
        "UPDATE chapters SET title = ?1, content = ?2, word_count = ?3, updated_at = ?4
         WHERE id = ?5 AND novel_id = ?6",
        params![
            rev.title,
            rev.content,
            rev.word_count as i64,
            now.to_rfc3339(),
            chapter_id,
            novel_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    let chapter = conn
        .query_row(
            "SELECT id, title, content, \"order\", word_count, created_at, updated_at
             FROM chapters WHERE id = ?1",
            params![chapter_id],
            |row| {
                Ok(Chapter {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    content_loaded: true,
                    order: row.get::<_, i64>(3)? as usize,
                    word_count: row.get::<_, i64>(4)? as usize,
                    created_at: parse_dt(row.get::<_, String>(5)?),
                    updated_at: parse_dt(row.get::<_, String>(6)?),
                })
            },
        )
        .map_err(|_| "Chapter not found".to_string())?;
    Ok(chapter)
}

#[tauri::command]
pub fn list_chapter_revisions(
    db: State<DbConnection>,
    novel_id: String,
    chapter_id: String,
) -> Result<Vec<ChapterRevision>, String> {
    let conn = lock_db(&db)?;
    // 按 (novel_id, chapter_id) 联合过滤，确保只能读取本作品下的版本（防止越权读）
    list_chapter_revisions_inner(&conn, &novel_id, &chapter_id)
}

#[tauri::command]
pub fn get_chapter_revision(
    db: State<DbConnection>,
    novel_id: String,
    revision_id: String,
) -> Result<ChapterRevision, String> {
    let conn = lock_db(&db)?;
    get_chapter_revision_inner(&conn, &novel_id, &revision_id)
}

#[tauri::command]
pub fn restore_chapter_revision(
    db: State<DbConnection>,
    novel_id: String,
    chapter_id: String,
    revision_id: String,
) -> Result<Chapter, String> {
    let conn = lock_db(&db)?;
    restore_chapter_inner(&conn, &novel_id, &chapter_id, &revision_id)
}

// ============ 写作统计（日快照聚合） ============

/// 读取写作日快照。
/// - `novel_id = Some(id)`：返回该本按日期升序的累计快照；
/// - `novel_id = None`：跨全部作品按日期聚合（同日各本字数/章节数求和），
///   用于工作台「总字数趋势」全局视图。
#[tauri::command]
pub fn get_writing_stats(
    db: State<DbConnection>,
    novel_id: Option<String>,
) -> Result<Vec<WritingDailyStat>, String> {
    let conn = lock_db(&db)?;
    let rows = match novel_id {
        Some(id) => {
            let mut stmt = conn
                .prepare(
                    "SELECT novel_id, stat_date, total_words, chapter_count
                     FROM writing_daily_stats WHERE novel_id = ?1 ORDER BY stat_date ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![id], |row| {
                    Ok(WritingDailyStat {
                        novel_id: row.get(0)?,
                        stat_date: row.get(1)?,
                        total_words: row.get::<_, i64>(2)? as usize,
                        chapter_count: row.get::<_, i64>(3)? as usize,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT 'ALL', stat_date, COALESCE(SUM(total_words), 0), COALESCE(SUM(chapter_count), 0)
                     FROM writing_daily_stats GROUP BY stat_date ORDER BY stat_date ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(WritingDailyStat {
                        novel_id: row.get(0)?,
                        stat_date: row.get(1)?,
                        total_words: row.get::<_, i64>(2)? as usize,
                        chapter_count: row.get::<_, i64>(3)? as usize,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        }
    };
    Ok(rows)
}

// ============ 角色关系图谱（节点 = 角色，边 = 关系） ============

/// 读取某本小说的全部角色（按创建时间升序）。
fn list_characters_inner(conn: &Connection, novel_id: &str) -> Result<Vec<Character>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, novel_id, name, identity, description, color, created_at, updated_at
             FROM characters WHERE novel_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let chars = stmt
        .query_map(params![novel_id], |row| {
            Ok(Character {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                name: row.get(2)?,
                identity: row.get(3)?,
                description: row.get(4)?,
                color: row.get(5)?,
                created_at: parse_dt(row.get::<_, String>(6)?),
                updated_at: parse_dt(row.get::<_, String>(7)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(chars)
}

/// 新建一个角色（颜色缺省取品牌蓝）。
fn create_character_inner(
    conn: &Connection,
    novel_id: &str,
    name: String,
    identity: Option<String>,
    description: Option<String>,
    color: Option<String>,
) -> Result<Character, String> {
    let now = Utc::now();
    let ch = Character {
        id: Uuid::new_v4().to_string(),
        novel_id: novel_id.to_string(),
        name,
        identity: identity.filter(|s| !s.is_empty()),
        description: description.filter(|s| !s.is_empty()),
        color: color.filter(|s| !s.is_empty()).unwrap_or_else(|| "#2FAEFF".to_string()),
        created_at: now,
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO characters (id, novel_id, name, identity, description, color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            ch.id,
            ch.novel_id,
            ch.name,
            ch.identity,
            ch.description,
            ch.color,
            ch.created_at.to_rfc3339(),
            ch.updated_at.to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(ch)
}

/// 局部更新角色：仅对传入非 None 的字段赋值（COALESCE 保留原值）。
fn update_character_inner(
    conn: &Connection,
    id: &str,
    name: Option<String>,
    identity: Option<String>,
    description: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE characters SET
            name = COALESCE(?1, name),
            identity = COALESCE(?2, identity),
            description = COALESCE(?3, description),
            color = COALESCE(?4, color),
            updated_at = ?5
         WHERE id = ?6",
        params![
            name,
            identity,
            description,
            color,
            Utc::now().to_rfc3339(),
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除角色。与之相关的所有关系由外键 `ON DELETE CASCADE` 自动清理。
fn delete_character_inner(conn: &Connection, novel_id: &str, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM characters WHERE id = ?1 AND novel_id = ?2",
        params![id, novel_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取某本小说的全部关系（按创建时间升序）。
fn list_character_relations_inner(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<CharacterRelation>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, novel_id, from_id, to_id, category, label, description, created_at
             FROM character_relations WHERE novel_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rels = stmt
        .query_map(params![novel_id], |row| {
            Ok(CharacterRelation {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                from_id: row.get(2)?,
                to_id: row.get(3)?,
                category: row.get(4)?,
                label: row.get(5)?,
                description: row.get(6)?,
                created_at: parse_dt(row.get::<_, String>(7)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rels)
}

/// 插入或更新一条关系：
/// - 同一对角色（`novel_id, from_id, to_id`）唯一，再次连线为更新其
///   `category`/`label`/`description`，保留原 `id`（ON CONFLICT DO UPDATE）；
/// - 禁止自连（from === to）。
/// 返回写库后的那一行（无论新插还是更新）。
fn upsert_relation_inner(
    conn: &Connection,
    novel_id: &str,
    from_id: &str,
    to_id: &str,
    category: String,
    label: Option<String>,
    description: Option<String>,
) -> Result<CharacterRelation, String> {
    if from_id == to_id {
        return Err("不能将角色连接到自身".to_string());
    }
    let now = Utc::now();
    conn.execute(
        "INSERT INTO character_relations (id, novel_id, from_id, to_id, category, label, description, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(novel_id, from_id, to_id) DO UPDATE SET
            category    = excluded.category,
            label       = excluded.label,
            description = excluded.description,
            created_at  = excluded.created_at",
        params![
            Uuid::new_v4().to_string(),
            novel_id,
            from_id,
            to_id,
            category,
            label.filter(|s| !s.is_empty()),
            description.filter(|s| !s.is_empty()),
            now.to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;

    let rel = conn
        .query_row(
            "SELECT id, novel_id, from_id, to_id, category, label, description, created_at
             FROM character_relations WHERE novel_id = ?1 AND from_id = ?2 AND to_id = ?3",
            params![novel_id, from_id, to_id],
            |row| {
                Ok(CharacterRelation {
                    id: row.get(0)?,
                    novel_id: row.get(1)?,
                    from_id: row.get(2)?,
                    to_id: row.get(3)?,
                    category: row.get(4)?,
                    label: row.get(5)?,
                    description: row.get(6)?,
                    created_at: parse_dt(row.get::<_, String>(7)?),
                })
            },
        )
        .map_err(|_| "保存关系失败".to_string())?;
    Ok(rel)
}

/// 删除一条关系。
fn delete_relation_inner(conn: &Connection, novel_id: &str, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM character_relations WHERE id = ?1 AND novel_id = ?2",
        params![id, novel_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ===== Tauri 命令（签名与前端调用保持一致） =====

#[tauri::command]
pub fn list_characters(
    db: State<DbConnection>,
    novel_id: String,
) -> Result<Vec<Character>, String> {
    let conn = lock_db(&db)?;
    list_characters_inner(&conn, &novel_id)
}

#[tauri::command]
pub fn create_character(
    db: State<DbConnection>,
    novel_id: String,
    name: String,
    identity: Option<String>,
    description: Option<String>,
    color: Option<String>,
) -> Result<Character, String> {
    let conn = lock_db(&db)?;
    create_character_inner(&conn, &novel_id, name, identity, description, color)
}

#[tauri::command]
pub fn update_character(
    db: State<DbConnection>,
    id: String,
    name: Option<String>,
    identity: Option<String>,
    description: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    update_character_inner(&conn, &id, name, identity, description, color)
}

#[tauri::command]
pub fn delete_character(
    db: State<DbConnection>,
    novel_id: String,
    id: String,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    delete_character_inner(&conn, &novel_id, &id)
}

#[tauri::command]
pub fn list_character_relations(
    db: State<DbConnection>,
    novel_id: String,
) -> Result<Vec<CharacterRelation>, String> {
    let conn = lock_db(&db)?;
    list_character_relations_inner(&conn, &novel_id)
}

#[tauri::command]
pub fn upsert_character_relation(
    db: State<DbConnection>,
    novel_id: String,
    from_id: String,
    to_id: String,
    category: String,
    label: Option<String>,
    description: Option<String>,
) -> Result<CharacterRelation, String> {
    let conn = lock_db(&db)?;
    upsert_relation_inner(&conn, &novel_id, &from_id, &to_id, category, label, description)
}

#[tauri::command]
pub fn delete_character_relation(
    db: State<DbConnection>,
    novel_id: String,
    id: String,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    delete_relation_inner(&conn, &novel_id, &id)
}

// ============ 单元测试（#[cfg(test)]，用内存数据库验证 DB 往返） ============

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::models::novel::{Chapter, Character, CharacterRelation, NovelProject};
    use chrono::Utc;
    use rusqlite::Connection;

    /// 构造一本带若干章节的小说，字段全部显式填充，便于断言往返一致性。
    fn sample_novel(prefix: &str, chapters: Vec<(String, String, usize)>) -> NovelProject {
        let now = Utc::now();
        let mut novel = NovelProject::new(
            "测试书名".into(),
            "测试作者".into(),
            "奇幻".into(),
            "一段简介".into(),
        );
        novel.outline = Some("大纲内容".into());
        novel.cover_path = Some("/tmp/cover.png".into());
        novel.chapters = chapters
            .into_iter()
            .enumerate()
            .map(|(i, (title, content, wc))| Chapter {
                id: format!("{}-ch-{}", prefix, i),
                title,
                content,
                content_loaded: true,
                order: i,
                word_count: wc,
                created_at: now,
                updated_at: now,
            })
            .collect();
        novel
    }

    #[test]
    fn upsert_then_load_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let novel = sample_novel("t1", vec![("第一章".into(), "<p>内容</p>".into(), 3)]);
        let id = novel.id.clone();

        upsert_novel(&conn, &novel).expect("upsert 应成功");

        let loaded = load_novel(&conn, &id).expect("load 应成功");
        assert_eq!(loaded.title, novel.title);
        assert_eq!(loaded.author, novel.author);
        assert_eq!(loaded.genre, novel.genre);
        assert_eq!(loaded.description, novel.description);
        assert_eq!(loaded.cover_path, novel.cover_path);
        assert_eq!(loaded.outline, novel.outline);
        assert_eq!(loaded.chapters.len(), 1);
        assert_eq!(loaded.chapters[0].title, "第一章");
        // MD-17：load_novel 仅返回章节元数据，正文不随整体加载
        assert_eq!(loaded.chapters[0].content, "");
        assert_eq!(loaded.chapters[0].content_loaded, false);
        // 正文需经 read_chapter_content 按需取回，验证 upsert 已落盘
        let content = read_chapter_content(&conn, &id, &loaded.chapters[0].id).unwrap();
        assert_eq!(content, "<p>内容</p>");
        assert_eq!(loaded.chapters[0].word_count, 3);
    }

    #[test]
    fn chapters_preserve_order_and_word_count() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let novel = sample_novel("t2", vec![
            ("甲".into(), "A".into(), 10),
            ("乙".into(), "BB".into(), 20),
            ("丙".into(), "CCC".into(), 30),
        ]);
        let id = novel.id.clone();
        upsert_novel(&conn, &novel).unwrap();

        let loaded = load_novel(&conn, &id).unwrap();
        assert_eq!(loaded.chapters.len(), 3);
        // 校验按 order 升序返回
        let titles: Vec<&str> = loaded.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["甲", "乙", "丙"]);
        let counts: Vec<usize> = loaded.chapters.iter().map(|c| c.word_count).collect();
        assert_eq!(counts, vec![10, 20, 30]);
    }

    #[test]
    fn upsert_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let mut novel = sample_novel("t3", vec![("初稿".into(), "x".into(), 1)]);
        let id = novel.id.clone();
        upsert_novel(&conn, &novel).unwrap();

        // 二次 upsert 同 id，修改标题与章节，应覆盖而非新增
        novel.title = "修订版".into();
        novel.chapters[0].title = "终稿".into();
        novel.chapters[0].word_count = 99;
        upsert_novel(&conn, &novel).unwrap();

        let loaded = load_novel(&conn, &id).unwrap();
        assert_eq!(loaded.title, "修订版");
        assert_eq!(loaded.chapters.len(), 1);
        assert_eq!(loaded.chapters[0].title, "终稿");
        assert_eq!(loaded.chapters[0].word_count, 99);

        // 列表里只应有 1 本，验证未被重复插入
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM novels", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn parse_dt_valid_and_fallback() {
        // 合法 RFC3339 应原样解析
        let ok = parse_dt("2026-01-02T03:04:05Z".to_string());
        assert_eq!(ok.to_rfc3339(), "2026-01-02T03:04:05+00:00");

        // 脏数据不应 panic，应回退到接近当前时间
        let before = Utc::now();
        let fallback = parse_dt("not-a-date".to_string());
        let after = Utc::now();
        assert!(fallback >= before && fallback <= after);
    }

    #[test]
    fn list_aggregation_counts_chapters_and_words() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let n1 = sample_novel("n1", vec![("a".into(), "x".into(), 10), ("b".into(), "y".into(), 20)]);
        let n2 = sample_novel("n2", vec![("c".into(), "z".into(), 5)]);
        upsert_novel(&conn, &n1).unwrap();
        upsert_novel(&conn, &n2).unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT n.id, COUNT(c.id) AS chapter_count,
                        COALESCE(SUM(c.word_count), 0) AS total_word_count
                 FROM novels n LEFT JOIN chapters c ON c.novel_id = n.id
                 GROUP BY n.id",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(1)? as usize, row.get::<_, i64>(2)? as usize))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect::<Vec<_>>();

        assert_eq!(rows.len(), 2);
        assert!(rows.contains(&(2, 30)));
        assert!(rows.contains(&(1, 5)));
    }

    /// 差分保存：仅改动一个章节时，未变更的章节不应被重写
    /// （验证其 created_at 保持不变，证明走的是 UPDATE/跳过而非 DELETE + 全量 INSERT）。
    #[test]
    fn differential_save_keeps_unchanged_chapters() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let mut novel = sample_novel(
            "diff",
            vec![
                ("甲".into(), "<p>甲初稿</p>".into(), 10),
                ("乙".into(), "<p>乙初稿</p>".into(), 10),
            ],
        );
        let id = novel.id.clone();
        upsert_novel(&conn, &novel).unwrap();

        // 记录乙章节保存后的 created_at
        let before = load_novel(&conn, &id).unwrap();
        let ch_b_before = before.chapters[1].created_at;

        // 仅修改甲章节内容，乙保持不变
        novel.chapters[0].content = "<p>甲修订稿</p>".into();
        novel.chapters[0].word_count = 20;
        upsert_novel(&conn, &novel).unwrap();

        let after = load_novel(&conn, &id).unwrap();
        assert_eq!(after.chapters.len(), 2);
        // 甲已更新（MD-17：正文经 read_chapter_content 按需取回验证）
        let ch_a_content = read_chapter_content(&conn, &id, &after.chapters[0].id).unwrap();
        assert_eq!(ch_a_content, "<p>甲修订稿</p>");
        // 乙未变，且 created_at 原样保留（证明未被删除重建）
        let ch_b_content = read_chapter_content(&conn, &id, &after.chapters[1].id).unwrap();
        assert_eq!(ch_b_content, "<p>乙初稿</p>");
        assert_eq!(after.chapters[1].created_at, ch_b_before);
    }

    /// 版本历史：章节内容变更时应自动存档，且能恢复到旧版本。
    #[test]
    fn revision_archived_on_change_and_restorable() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let mut novel = sample_novel("rev", vec![("甲".into(), "<p>初稿</p>".into(), 3)]);
        let id = novel.id.clone();
        let ch_id = novel.chapters[0].id.clone();
        upsert_novel(&conn, &novel).unwrap();

        // 改内容再保存一次
        novel.chapters[0].content = "<p>修订稿</p>".into();
        novel.chapters[0].word_count = 5;
        upsert_novel(&conn, &novel).unwrap();

        // 应有 2 份版本（初版 + 修订版），按序号升序
        let revs: Vec<(String, i64)> = conn
            .prepare(
                "SELECT content, revision_index FROM chapter_revisions WHERE chapter_id = ?1 ORDER BY revision_index ASC",
            )
            .unwrap()
            .query_map(params![ch_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(revs.len(), 2);
        assert_eq!(revs[0].0, "<p>初稿</p>");
        assert_eq!(revs[0].1, 0);
        assert_eq!(revs[1].0, "<p>修订稿</p>");
        assert_eq!(revs[1].1, 1);

        // 恢复到初版
        let rev0_id: String = conn
            .query_row(
                "SELECT id FROM chapter_revisions WHERE chapter_id = ?1 AND revision_index = 0",
                params![ch_id],
                |r| r.get(0),
            )
            .unwrap();
        let restored = restore_chapter_inner(&conn, &id, &ch_id, &rev0_id).unwrap();
        assert_eq!(restored.content, "<p>初稿</p>");
    }

    /// 版本历史：内容未变（仅标题变）时，不应产生重复内容存档。
    #[test]
    fn revision_idempotent_skip_when_content_unchanged() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let mut novel = sample_novel("rev2", vec![("甲".into(), "<p>内容</p>".into(), 3)]);
        let ch_id = novel.chapters[0].id.clone();
        upsert_novel(&conn, &novel).unwrap();

        // 仅改标题、内容不变 → 不应新增版本
        novel.chapters[0].title = "新标题".into();
        upsert_novel(&conn, &novel).unwrap();

        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chapter_revisions WHERE chapter_id = ?1",
                params![ch_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 1, "内容未变不应产生重复存档");
    }

    /// 版本历史：每章节最多保留 50 份，超出后最旧的被清理。
    #[test]
    fn revision_prunes_beyond_limit() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let mut novel = sample_novel("rev3", vec![("甲".into(), "v0".into(), 1)]);
        let ch_id = novel.chapters[0].id.clone();
        upsert_novel(&conn, &novel).unwrap();

        // 连续写入 60 个不同内容版本
        for i in 1..60 {
            novel.chapters[0].content = format!("v{}", i);
            upsert_novel(&conn, &novel).unwrap();
        }

        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chapter_revisions WHERE chapter_id = ?1",
                params![ch_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 50, "超出上限的版本应被清理");

        // 最新一份应为 v59
        let latest: String = conn
            .query_row(
                "SELECT content FROM chapter_revisions WHERE chapter_id = ?1 ORDER BY revision_index DESC LIMIT 1",
                params![ch_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(latest, "v59");
    }

    /// 写作统计：保存后应按当天日期写入一条累计快照，
    /// 再次保存到同一天则覆盖（不产生重复行）。
    #[test]
    fn daily_stat_recorded_and_idempotent_per_day() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let novel = sample_novel("stat1", vec![
            ("甲".into(), "a".into(), 10),
            ("乙".into(), "b".into(), 20),
        ]);
        let id = novel.id.clone();
        upsert_novel(&conn, &novel).unwrap();

        let date: String = Utc::now().format("%Y-%m-%d").to_string();
        let row: (i64, i64) = conn
            .query_row(
                "SELECT total_words, chapter_count FROM writing_daily_stats WHERE novel_id = ?1 AND stat_date = ?2",
                params![id, date],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row.0, 30, "累计字数应为章节之和");
        assert_eq!(row.1, 2, "章节数应为 2");

        // 同日再次保存（改字数）→ 应覆盖而非新增
        let mut novel2 = novel;
        novel2.chapters[0].word_count = 100;
        novel2.chapters[0].content = "aaaa".into();
        upsert_novel(&conn, &novel2).unwrap();

        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM writing_daily_stats WHERE novel_id = ?1 AND stat_date = ?2",
                params![id, date],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 1, "同日只应有一行快照");

        let total: i64 = conn
            .query_row(
                "SELECT total_words FROM writing_daily_stats WHERE novel_id = ?1 AND stat_date = ?2",
                params![id, date],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total, 120, "覆盖后应为新累计值");
    }

    /// 写作统计：跨本聚合（与 `get_writing_stats(None)` 同款 SQL）按日期求和。
    #[test]
    fn writing_stats_aggregate_across_novels() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let n1 = sample_novel("agg1", vec![("a".into(), "x".into(), 10)]);
        let n2 = sample_novel("agg2", vec![("b".into(), "y".into(), 5)]);
        upsert_novel(&conn, &n1).unwrap();
        upsert_novel(&conn, &n2).unwrap();

        // 与 get_writing_stats(None) 完全一致的聚合查询
        let date: String = Utc::now().format("%Y-%m-%d").to_string();
        let row: (i64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(total_words), 0), COALESCE(SUM(chapter_count), 0)
                 FROM writing_daily_stats WHERE stat_date = ?1",
                params![date],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row.0, 15, "跨本累计应为 10 + 5");
        assert_eq!(row.1, 2);
    }

    /// 角色关系：创建角色、同对角色 upsert 保留原 id 且只留一条边、
    /// 禁自连、删除角色后关系级联清理。
    #[test]
    fn character_upsert_and_relation_cascade() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn);

        let novel = sample_novel("ch", vec![]);
        let nid = novel.id.clone();
        upsert_novel(&conn, &novel).unwrap();

        let c1 = create_character_inner(&conn, &nid, "甲".into(), None, None, None).unwrap();
        let c2 = create_character_inner(&conn, &nid, "乙".into(), None, None, None).unwrap();

        let chars: Vec<Character> = list_characters_inner(&conn, &nid).unwrap();
        assert_eq!(chars.len(), 2, "应有两个角色");

        let r1 = upsert_relation_inner(&conn, &nid, &c1.id, &c2.id, "blood".into(), Some("父子".into()), None).unwrap();
        let r2 = upsert_relation_inner(&conn, &nid, &c1.id, &c2.id, "enemy".into(), Some("宿敌".into()), None).unwrap();
        assert_eq!(r1.id, r2.id, "同 (from,to) 应保留原 id");

        let rels: Vec<CharacterRelation> = list_character_relations_inner(&conn, &nid).unwrap();
        assert_eq!(rels.len(), 1, "同对角色只应有一条边");
        assert_eq!(rels[0].category, "enemy", "再次连线应更新为最新类别");
        assert_eq!(rels[0].label.as_deref(), Some("宿敌"));

        let self_res = upsert_relation_inner(&conn, &nid, &c1.id, &c1.id, "other".into(), None, None);
        assert!(self_res.is_err(), "自连应被拒绝");

        delete_character_inner(&conn, &nid, &c1.id).unwrap();
        let rels2: Vec<CharacterRelation> = list_character_relations_inner(&conn, &nid).unwrap();
        assert_eq!(rels2.len(), 0, "角色删除后关系应级联清理");
    }

}
