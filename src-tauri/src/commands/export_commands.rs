use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;

use tauri::command;
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::commands::novel_commands::{load_novel, lock_db, read_chapter_content};
use crate::db::DbConnection;
use crate::models::novel::NovelProject;
use rusqlite::Connection;

/// 解析并校验导出路径，强制写入专用导出目录，杜绝任意路径写入（路径穿越）。
///
/// 仅取传入路径的文件名部分，拼到 `~/Documents/InkScholar/exports/` 下，
/// 并对扩展名与父目录进行校验，确保无法逃出导出目录。
fn resolve_export_path(output_path: &str, expected_ext: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(output_path);
    let file_name = raw
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无效的导出路径".to_string())?;

    if !file_name.to_lowercase().ends_with(expected_ext) {
        return Err(format!("导出文件扩展名必须为 .{}", expected_ext));
    }

    let mut exports_dir = dirs::document_dir().unwrap_or_else(|| PathBuf::from("."));
    exports_dir.push("InkScholar");
    exports_dir.push("exports");
    fs::create_dir_all(&exports_dir).map_err(|e| format!("无法创建导出目录: {}", e))?;

    // 文件名来自 dialog，已过滤扩展名；再 canonicalize 兜底防止 `..` 之类的越界。
    let mut target = exports_dir.join(file_name);
    if let Ok(canonical) = target.canonicalize() {
        target = canonical;
    }
    Ok(target)
}

/// 懒加载生效（MD-17）：`load_novel` 不再返回章节正文，导出前按需补全各章 content。
/// 仅补全 `content_loaded = false` 的章节，已加载的不重复查库；章节已被删等异常时跳过。
fn fill_chapter_contents(conn: &Connection, novel_id: &str, novel: &mut NovelProject) {
    for ch in &mut novel.chapters {
        if !ch.content_loaded {
            if let Ok(content) = read_chapter_content(conn, novel_id, &ch.id) {
                ch.content = content;
                ch.content_loaded = true;
            }
        }
    }
}

#[command]
pub fn export_to_txt(
    db: State<DbConnection>,
    novel_id: String,
    output_path: String,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    let mut novel = load_novel(&conn, &novel_id)?;
    // 懒加载生效（MD-17）：load_novel 不再返回正文，导出前按需补全各章 content
    fill_chapter_contents(&conn, &novel_id, &mut novel);
    drop(conn); // 拿到数据后立即释放 DB 锁，避免长时间持有阻塞 autosave
    let path = resolve_export_path(&output_path, "txt")?;
    let content = build_txt(&novel);
    fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))
}

#[command]
pub fn export_to_markdown(
    db: State<DbConnection>,
    novel_id: String,
    output_path: String,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    let mut novel = load_novel(&conn, &novel_id)?;
    // 懒加载生效（MD-17）：load_novel 不再返回正文，导出前按需补全各章 content
    fill_chapter_contents(&conn, &novel_id, &mut novel);
    drop(conn);
    let path = resolve_export_path(&output_path, "md")?;
    let content = build_markdown(&novel);
    fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))
}

/// 导出 EPUB3 电子书：用 zip crate 在内存中打包标准 EPUB 结构后写盘。
#[command]
pub fn export_to_epub(
    db: State<DbConnection>,
    novel_id: String,
    output_path: String,
) -> Result<(), String> {
    let conn = lock_db(&db)?;
    let mut novel = load_novel(&conn, &novel_id)?;
    // 懒加载生效（MD-17）：load_novel 不再返回正文，导出前按需补全各章 content
    fill_chapter_contents(&conn, &novel_id, &mut novel);
    drop(conn);
    let bytes = build_epub(&novel).map_err(|e| format!("生成 EPUB 失败: {}", e))?;
    let path = resolve_export_path(&output_path, "epub")?;
    fs::write(&path, bytes).map_err(|e| format!("写入文件失败: {}", e))
}

fn build_txt(novel: &NovelProject) -> String {
    let mut content = String::new();
    content.push_str(&format!("{}\n", novel.title));
    content.push_str(&format!("作者：{}\n", novel.author));
    content.push_str(&format!("类型：{}\n", novel.genre));
    content.push_str(&format!("简介：{}\n\n", novel.description));

    for chapter in &novel.chapters {
        content.push_str(&format!("{}\n\n", chapter.title));
        content.push_str(&format!("{}\n\n", chapter.content));
        content.push_str("---\n\n");
    }

    content
}

fn build_markdown(novel: &NovelProject) -> String {
    let mut content = String::new();
    content.push_str(&format!("# {}\n\n", novel.title));
    content.push_str(&format!("**作者**：{}\n\n", novel.author));
    content.push_str(&format!("**类型**：{}\n\n", novel.genre));
    content.push_str(&format!("**简介**：{}\n\n", novel.description));
    content.push_str("---\n\n");

    for chapter in &novel.chapters {
        content.push_str(&format!("## {}\n\n", chapter.title));
        content.push_str(&format!("{}\n\n", chapter.content));
    }

    content
}

// ============ EPUB3 构建 ============

/// 对 XML 文本做转义（用于标题等会嵌入 XML 的字段）。
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// 生成完整 EPUB3 压缩包字节流。
fn build_epub(novel: &NovelProject) -> Result<Vec<u8>, String> {
    // 章节为空时补一个占位页，保证 spine 非空（合法 EPUB 必须有至少一个内容文档）
    let chapters_ref: Vec<(usize, &str, &str)> = if novel.chapters.is_empty() {
        vec![(1, "（暂无章节）", "<p>本书尚未添加任何章节。</p>")]
    } else {
        novel
            .chapters
            .iter()
            .enumerate()
            .map(|(i, c)| (i + 1, c.title.as_str(), c.content.as_str()))
            .collect()
    };

    let now = chrono::Utc::now().to_rfc3339();
    let uuid = &novel.id;
    let title = xml_escape(&novel.title);
    let author = xml_escape(&novel.author);

    // ---- 各组件内容 ----
    let mimetype = "application/epub+zip";

    let container = r#"<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let css = "body { font-family: serif; line-height: 1.7; margin: 1.2em; color: #222; }\n\
               h1 { font-size: 1.4em; text-align: center; margin: 1.2em 0; }\n\
               section { margin-bottom: 2em; }\n\
               p { text-indent: 2em; margin: 0.6em 0; }\n";

    // content.opf
    let mut manifest_items = String::new();
    let mut spine_items = String::new();
    for (i, (_, t, _)) in chapters_ref.iter().enumerate() {
        let _ = t;
        let idx = i + 1;
        let href = format!("text/ch{:02}.xhtml", idx);
        manifest_items.push_str(&format!(
            "    <item id=\"ch{:02}\" href=\"{}\" media-type=\"application/xhtml+xml\"/>\n",
            idx, href
        ));
        spine_items.push_str(&format!("    <itemref idref=\"ch{:02}\"/>\n", idx));
    }

    let content_opf = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:{}</dc:identifier>
    <dc:title>{}</dc:title>
    <dc:creator>{}</dc:creator>
    <dc:language>zh</dc:language>
    <dc:date>{}</dc:date>
    <meta property="dcterms:modified">{}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="stylesheet.css" media-type="text/css"/>
{}
  </manifest>
  <spine>
{}
  </spine>
</package>"#,
        uuid, title, author, now, now, manifest_items, spine_items
    );

    // nav.xhtml（EPUB3 目录）
    let mut toc_items = String::new();
    for (i, (_, t, _)) in chapters_ref.iter().enumerate() {
        let idx = i + 1;
        toc_items.push_str(&format!(
            "      <li><a href=\"text/ch{:02}.xhtml\">{}</a></li>\n",
            idx,
            xml_escape(t)
        ));
    }
    let nav = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
{}
    </ol>
  </nav>
</body>
</html>"#,
        toc_items
    );

    // 每章一个 xhtml
    let mut chapter_files: Vec<(String, String)> = Vec::new();
    for (i, (_, t, body)) in chapters_ref.iter().enumerate() {
        let idx = i + 1;
        let fname = format!("text/ch{:02}.xhtml", idx);
        // 章节正文为 Tiptap 生成的 HTML，直接拼入 XHTML 会因裸 < > & 产生非法标记；
        // 包裹 CDATA 既保留排版标签，又避免 XML 解析失败（转义 ]]> 以防提前闭合）。
        let safe_body = body.replace("]]>", "]]]]><![CDATA[>");
        let xhtml = format!(
            r#"<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>{}</title><link rel="stylesheet" type="text/css" href="../stylesheet.css"/></head>
<body>
  <section epub:type="chapter">
    <h1>{}</h1>
  <![CDATA[{}]]>
  </section>
</body>
</html>"#,
            xml_escape(t),
            xml_escape(t),
            safe_body
        );
        chapter_files.push((fname, xhtml));
    }

    // ---- 打包 ----
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut zip = ZipWriter::new(Cursor::new(&mut buf));

        // mimetype 必须第一个且用 Stored（不压缩）
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("mimetype", stored)
            .map_err(|e| e.to_string())?;
        zip.write_all(mimetype.as_bytes())
            .map_err(|e| e.to_string())?;

        let deflated = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);

        zip.start_file("META-INF/container.xml", deflated)
            .map_err(|e| e.to_string())?;
        zip.write_all(container.as_bytes())
            .map_err(|e| e.to_string())?;

        zip.start_file("OEBPS/content.opf", deflated)
            .map_err(|e| e.to_string())?;
        zip.write_all(content_opf.as_bytes())
            .map_err(|e| e.to_string())?;

        zip.start_file("OEBPS/nav.xhtml", deflated)
            .map_err(|e| e.to_string())?;
        zip.write_all(nav.as_bytes())
            .map_err(|e| e.to_string())?;

        zip.start_file("OEBPS/stylesheet.css", deflated)
            .map_err(|e| e.to_string())?;
        zip.write_all(css.as_bytes())
            .map_err(|e| e.to_string())?;

        for (fname, content) in &chapter_files {
            let path = format!("OEBPS/{}", fname);
            zip.start_file(path, deflated)
                .map_err(|e| e.to_string())?;
            zip.write_all(content.as_bytes())
                .map_err(|e| e.to_string())?;
        }

        zip.finish().map_err(|e| e.to_string())?;
    }

    Ok(buf)
}

// ============ 单元测试（#[cfg(test)]，验证 EPUB 包结构合法） ============

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::novel::{Chapter, NovelProject};
    use chrono::Utc;
    use std::io::Read;
    use zip::ZipArchive;

    fn sample() -> NovelProject {
        let now = Utc::now();
        let mut novel = NovelProject::new("测试书".into(), "作者甲".into(), "奇幻".into(), "简介".into());
        novel.chapters = vec![
            Chapter {
                id: "ch-0".into(),
                title: "第一章".into(),
                content: "<p>正文一</p>".into(),
                content_loaded: true,
                order: 0,
                word_count: 3,
                created_at: now,
                updated_at: now,
            },
            Chapter {
                id: "ch-1".into(),
                title: "第二章".into(),
                content: "<p>正文二</p>".into(),
                content_loaded: true,
                order: 1,
                word_count: 3,
                created_at: now,
                updated_at: now,
            },
        ];
        novel
    }

    #[test]
    fn build_epub_produces_valid_package() {
        let bytes = build_epub(&sample()).expect("build_epub 应成功");
        assert!(!bytes.is_empty(), "EPUB 不应为空");

        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("应是合法 zip");

        // 必须包含的核心组件
        for name in &[
            "mimetype",
            "META-INF/container.xml",
            "OEBPS/content.opf",
            "OEBPS/nav.xhtml",
            "OEBPS/stylesheet.css",
            "OEBPS/text/ch01.xhtml",
            "OEBPS/text/ch02.xhtml",
        ] {
            assert!(archive.by_name(name).is_ok(), "缺少必要组件: {}", name);
        }

        // mimetype 内容正确（独立块，读取后即释放可变借用）
        let mimetype_ok = {
            let mut mt = archive.by_name("mimetype").unwrap();
            let mut s = String::new();
            mt.read_to_string(&mut s).unwrap();
            s == "application/epub+zip"
        };
        assert!(mimetype_ok, "mimetype 内容应为 application/epub+zip");

        // content.opf 应声明 EPUB3 与本书标题
        let (is_v3, has_title) = {
            let mut opf = archive.by_name("OEBPS/content.opf").unwrap();
            let mut opf_s = String::new();
            opf.read_to_string(&mut opf_s).unwrap();
            (opf_s.contains("version=\"3.0\""), opf_s.contains("测试书"))
        };
        assert!(is_v3, "content.opf 应声明 EPUB 3.0");
        assert!(has_title, "content.opf 应包含书名");
    }

    #[test]
    fn build_epub_handles_empty_chapters() {
        let mut novel = NovelProject::new("空书".into(), "作者".into(), "x".into(), "".into());
        novel.chapters = vec![];
        let bytes = build_epub(&novel).expect("空章节也应能导出");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        // 空书仍应生成至少一个内容文档，保证 spine 非空
        assert!(archive.by_name("OEBPS/text/ch01.xhtml").is_ok());
    }
}
