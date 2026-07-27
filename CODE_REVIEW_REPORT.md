# AI Ink Scholar X — 全面代码审查报告

> 审查时间：2026-07-25
> 范围：`src/`（前端 React 19 + TS 7 + Zustand + TipTap）与 `src-tauri/src/`（Rust 后端：SQLite / AI Provider / 加密）
> 维度：代码质量与可读性 · 潜在 Bug 与逻辑错误 · 性能优化 · 安全漏洞 · 最佳实践
> 方法：逐文件人工走读 + 静态校验（Biome 2.5.5 / `tsc --noEmit`）

> ✅ **修复进度（2026-07-25）**：H1、H2、M1、M2、M3、M4、M5、M6 已全部修复并通过 `biome lint`（0 warning）、`tsc --noEmit`、`cargo check`（Rust 编译）。改动均为现有逻辑修正，未新增业务功能。

| 编号 | 修复点 | 主要改动文件 |
| --- | --- | --- |
| H1 | 流式渲染改为「稳定 id + 增量更新」，不再每片重建数组 | `AiPanel.tsx` |
| H2 | `currentChapter` 改为响应式选择器（订阅 `activeChapterId`），并修正编辑器 `onUpdate` 闭包写回旧章节的隐患 | `AiPanel.tsx`、`Editor/index.tsx` |
| M1/M2/M3 | 续写/灵感/优化统一携带 `buildNovelContext` 富上下文与 `buildContextMessages`；灵感 `style` 缺省「通用」 | `AiPanel.tsx`、`novelContext.ts` |
| M4 | `temperature`/`maxTokens` 从设置读取（带默认值），新增设置 UI | `useSettingsStore.ts`、`useAiStore.ts`、`Settings/index.tsx` |
| M5 | `get_chapter_revision` 增加 `novel_id` 归属校验，杜绝越权读快照 | `novel_commands.rs`、`useNovelStore.ts` |
| M6 | `delete_chapter` 删除后章节重排改为单条 `UPDATE`（相关子查询连续编号） | `novel_commands.rs` |

---

## 0. 总体评价

** strengths（做得好的地方）**
- 后端 SQL 查询**全部参数化**，无 SQL 注入面。
- API Key 采用 **AES-256-GCM + HKDF-SHA256（设备绑定）** 加密存储，明文不落 JSON（见 `secret_commands.rs` + 单元测试）。
- 章节正文**懒加载**（MD-17）、全局 HTTP 客户端复用（MD-16）、流式仅设建连超时（30s）避免长文生成被截断——架构决策合理。
- `novel_commands.rs` 防御性编程到位：`parse_dt` 脏数据兜底、`lock_db` 中毒恢复、revision 快照幂等、事务原子保存。
- Zustand **不可变更新**与 hooks 依赖问题已在早先一轮修复（`useExhaustiveDependencies` 0 错误）。

** weaknesses（主要短板）集中在前端 AI 交互层**：流式渲染的增量更新不一致、章节上下文非响应式、prompt 上下文构造存在语义错配与能力浪费。

---

## 1. 严重程度说明

| 级别 | 含义 | 处理建议 |
| --- | --- | --- |
| 🔴 高 (High) | 会导致错误结果/数据错乱或明显功能缺陷 | 必须修复 |
| 🟠 中 (Medium) | 逻辑/质量缺陷，影响正确性或体验 | 应修复 |
| 🟡 低 (Low) | 可维护性、风格、健壮性 | 迭代治理 |
| 🟢 正向 (Positive) | 设计良好，作为基线保留 | 维持 |

---

## 2. 🔴 高：必须修复

### H1 · AiPanel 流式渲染整体重建消息数组，导致组件反复重挂载
**文件**：`src/components/AiPanel/AiPanel.tsx`
`handleContinue` / `handleInspiration` / `handleOptimize` 在流式 chunk 回调里：

```ts
setMessages([
  mkMsg("user", "请继续写作"),
  mkMsg("assistant", content),   // 每片都重建整个数组
]);
```

`mkMsg` 内部用模块级 `msgSeq++` 生成 `id`。**每次 chunk 都新建 id → React `key` 每片都变 → `<Bubble>` 每次重新挂载** → 流式过程中滚动跳动、性能抖动，且丢失已渲染气泡的内部状态。

对照同文件 `sendChat` 已正确采用增量更新：
```ts
setMessages((prev) => {
  const updated = [...prev];
  updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent };
  return updated;
});
```

**改进建议**：三个 handler 统一为「先一次性写入 user+空 assistant，回调里只改最后一条 assistant 的 content」，与 `sendChat` 对齐；`user` 消息只在进入流式前写入一次，不要放进回调。

### H2 · `getCurrentChapter()` 非响应式调用，切换章节后拿到陈旧章节
**文件**：`src/components/AiPanel/AiPanel.tsx:40`、`src/views/Editor/index.tsx:46`
```ts
const currentChapter = novelStore.getCurrentChapter();   // 在 render 顶部直接调用，非选择器
```
`setActiveChapter` 只改 `activeChapterId`，**不改动 `currentNovel` 引用**，因此订阅 `currentNovel` 的组件在切换章节时**不会重渲染**，`getCurrentChapter()` 返回的是旧章节对象。

**后果**：在 AiPanel 切到章节 B 后点「续写/优化」，实际作用的是章节 A 的正文；Editor 中 `currentChapter` 也可能错位，直到其他状态变化触发重渲染才自愈。这是真实的逻辑错误。

**改进建议**：用派生选择器替代（返回 state 中的真实对象引用，随 `currentNovel`/`activeChapterId` 变化而更新）：
```ts
const currentChapter = useNovelStore((s) => {
  const n = s.currentNovel;
  if (!n || n.chapters.length === 0) return null;
  if (s.activeChapterId) {
    const m = n.chapters.find((c) => c.id === s.activeChapterId);
    if (m) return m;
  }
  return n.chapters[0];
});
```
（注意：不要把 `useNovelStore((s) => s.getCurrentChapter())` 直接当选择器——`getCurrentChapter` 内部调 `get()` 且每次返回新求值，易触发额外渲染；上面的内联选择器更稳。）

---

## 3. 🟠 中：应修复

### M1 · `handleInspiration` 参数语义错配（类型当风格）
**文件**：`src/components/AiPanel/AiPanel.tsx:137`
```ts
const msgs = PROMPTS.buildInspiration(
  direction,                 // context ✓
  currentNovel?.genre || "", // ← 第二参应为“写作风格”，却传入“类型(genre)”
  currentNovel?.title,
);
```
签名 `buildInspiration(context, style, novelContext)`。结果 prompt 里出现「写作风格：**玄幻**」，把"类型"当"风格"传给模型，语义错误。

**改进建议**：区分类型与风格：要么新增 `style` 字段让用户选择，要么把 genre 放进 `context`（故事背景）而非 `style`。至少应传 `currentNovel?.genre` 到 `context` 并在 UI 增加"写作风格"输入。

### M2 · AI 上下文只用书名，未接入 `buildNovelContext` 富上下文
**文件**：`src/services/novelContext.ts`（已实现 `buildNovelContext`）vs `src/components/AiPanel/AiPanel.tsx`
`novelContext.ts` 精心实现了把简介/大纲/人物拼进系统提示的 `buildNovelContext(novel)`，但 AiPanel 里 `continueWriting`/`buildInspiration`/`optimizeSentence` 三个调用**全部只传 `currentNovel?.title`（仅书名）**。`buildContextMessages` 也只拼 title/genre/author，未接大纲。

**后果**：续写/灵感/优化都缺失作品背景设定，生成质量显著低于应有水平——这是"有现成能力却没用上"的典型浪费。

**改进建议**：在 AiPanel 中 `import { buildNovelContext } from "@/services/novelContext"`，用 `buildNovelContext(currentNovel)` 的结果作为三个 PROMPTS 调用的 `novelContext` 参数；`buildContextMessages` 的 system 文本也追加该上下文。

### M3 · 三个 Action handler 上下文构造不一致
**文件**：`src/components/AiPanel/AiPanel.tsx`
- `handleContinue`：`[...buildContextMessages(), ...msgs]`（含作品 system 上下文）✓
- `handleInspiration`：`const chatMessages: ChatMessage[] = msgs;`（**完全没调 `buildContextMessages`**）✗
- `handleOptimize`：`const chatMessages: ChatMessage[] = msgs;`（同上）✗

灵感/优化模式丢失了书名/类型/作者上下文，与续写模式行为不一致。结合 M2 一并修复：三个 handler 统一为「`buildContextMessages()` + 去掉系统消息后的 prompt 消息 + 富 `novelContext`」。

### M4 · `useAiStore` 硬编码 `temperature: 0.7 / maxTokens: 2048`，不可配置
**文件**：`src/stores/useAiStore.ts:196-197`（chat）、`:230-231`（chatStream）
温度与最大生成长度写死，用户（尤其写长篇需要更长续写、或想调创意度）无法调整。

**改进建议**：在 `useSettingsStore` 增加 `aiTemperature`/`aiMaxTokens`，在构造 `ChatRequest` 时读取；或至少从 `activeProvider` 配置项取。设合理默认值并做范围校验（如 `0 ≤ temp ≤ 2`，`maxTokens ∈ [256, 8192]`）。

### M5 · `get_chapter_revision`（Rust）不校验归属，可越权读取任意版本
**文件**：`src-tauri/src/commands/novel_commands.rs:728`（`get_chapter_revision`）
```rust
pub fn get_chapter_revision(db, revision_id) -> Result<ChapterRevision> {
    get_chapter_revision_inner(&conn, &revision_id)   // 仅按 id 查，未验证所属 novel
}
```
同文件的 `list_chapter_revisions` 已用 `(novel_id, chapter_id)` 联合过滤防越权，但 `get_chapter_revision` 漏了。`restore_chapter_revision` 内部有 `rev.chapter_id != chapter_id || rev.novel_id != novel_id` 校验作为补偿，但 `get_chapter_revision` 单独暴露时仍可读取不属于当前作品的快照内容。本地单用户影响低，但属越权读取缺陷。

**改进建议**：改为 `get_chapter_revision_inner(conn, novel_id, revision_id)` 并在 SQL 加 `WHERE id = ?1 AND novel_id = ?2`；前端调用处补传 `novelId`。

### M6 · `delete_chapter` 重排 order 用 N 条独立 UPDATE
**文件**：`src-tauri/src/commands/novel_commands.rs:499`
删除章节后 `load_novel` 再对剩余章节**逐条 UPDATE `"order" = ?`**。章节多时（数百章）是 N 次写；且每次删除都重读全量。

**改进建议**：用单条批量更新替代循环：
```sql
UPDATE chapters SET "order" = "order" - 1
WHERE novel_id = ?1 AND "order" > ?2;
```
其中 `?2` 为被删章节原 order，整段包进已有事务（与 `reorder_chapters` 一并优化）。

---

## 4. 🟡 低：迭代治理

| 编号 | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| L1 | `Canvas.tsx` 约 1000 行未拆分；`edgeList` 中 `labelW = label.length * 13 + 24` 中文/英文混排宽度估算不准，关系标签可能溢出 | `src/views/Characters/Canvas.tsx` | 拆出 `RelationEdge`/`NodeBadge`/`CanvasToolbar` 子组件；`labelW` 改用 `Intl.Segmenter` 按字形计数或测量 DOM 宽度 |
| L2 | 内联样式 393 处（`nursery/noInlineStyles`） | 全前端 | 引入 CSS Modules / Tailwind，从源头收敛；先对高频复用的卡片/按钮抽公共类 |
| L3 | `console.error/warn` 13+ 处 | 多个 store | 生产构建清理；改用统一日志层（分级 + 可选上报） |
| L4 | 少量未用 import / `any` / 非空断言 `!` | 散见 | Biome 已标记，按 `biome check --write` 渐进清理（注意 `--unsafe` 会误改 `3.14159→Math.PI`，勿盲目） |
| L5 | 设备绑定加密对 hostname 变更脆弱（HKDF 派生密钥），换机/改名后旧 Key 不可解 | `secret_commands.rs` | 已知限制；前端应在解密失败时给出明确"请重新填写 API Key"引导，并在设置页提供"重置密钥"入口 |
| L6 | `optimizeParagraph`/`optimizeWord`/`fixGrammar` 已实现但 AiPanel 无入口（仅 `optimizeSentence`） | `prompts.ts` vs `AiPanel.tsx` | 补充 UI 入口或标注为未接能力，避免"有函数无功能"的误导 |

---

## 5. 🟢 安全专项（结论：整体良好）

- **无 SQL 注入**：所有 `rusqlite` 查询均参数化（`params!`/`?N`），未发现字符串拼接表名/列名（表名均为编译期常量）。
- **密钥安全**：API Key 经 `secure_set_api_key` 存入加密库，JSON store 只保留 `name`；加解密有单元测试覆盖（往返/异机失败/篡改失败）。
- **越权读取（低）**：仅 M5 一处 `get_chapter_revision` 缺归属校验，见上。
- **信息泄露（低）**：后端错误响应对上游 `error` 做了友好化（404 给出排错提示），其余错误透传文案，本地桌面应用风险有限；建议在 `ai_commands` 对上游原始错误做脱敏后再显示。
- **AI 上下文注入（低/设计）**：用户输入经模板字符串拼入 prompt（如 `continueWriting(previousText)`）。本地单用户、本地模型场景可接受；若接公网模型，建议对 `previousText` 做长度/特殊指令过滤。

---

## 6. ⚡ 性能专项

- **P1（高）**：AiPanel 流式整体重建消息数组，见 H1。
- **P2（中）**：`delete_chapter`/`reorder_chapters` 逐章 UPDATE，见 M6。
- **P3（正向）**：正文懒加载、`OnceLock` 全局连接池、流式仅建连超时——均为正确且必要的优化，保留。
- **P4（低）**：`list_novels` 每次 `COUNT/SUM` 聚合所有章节；作品/章节规模增长后变慢。可在 `upsert_novel` 时维护 `novels` 上的冗余 `chapter_count`/`total_words` 列，或在打开工作台时缓存。

---

## 7. ✅ 最佳实践与合规

- **已合规（早先一轮已修复，保留）**：
  - Zustand **不可变更新**（9 处原地 mutation 已改 `map`/展开）。
  - `biome lint` **0 error**、`tsc --noEmit` **0 error**、`useExhaustiveDependencies` **0 错误**（32 处修复）。
  - 三处真实运行时缺陷已修复：Settings 模板字符串缺 `${`、Editor 自动保存间隔陈旧闭包、`noConsole`/未用 import 清理。
- **建议补充**：
  - 跨组件统一"AI 上下文构造"为一个共享函数（消除 M1/M2/M3 的不一致）。
  - 增加 React `ErrorBoundary`，避免单个 AI 请求异常拖垮整个面板。
  - `ChatMessage[]` 构造与 normalize 解耦清晰，建议对 `ChatRequest` 增加 `validate` 守卫（temperature/maxTokens 范围）。
  - 把"温度/最大长度/系统提示前缀"等做成 Provider 级或全局设置，符合"用户可控"最佳实践。

---

## 8. 修复优先级建议

| 顺序 | 项 | 理由 |
| --- | --- | --- |
| 1 | H2 章节上下文非响应式 | 直接导致"续写/优化作用于错误章节"，属正确性 bug |
| 2 | H1 流式增量更新 | 影响每个 AI 交互的流畅度与性能 |
| 3 | M2 + M3 + M1 AI 上下文 | 一次性修补可显著提升生成质量与一致性 |
| 4 | M5 版本读取越权 | 一行 SQL 加固 |
| 5 | M4 温度/长度可配置 | 产品体验增强 |
| 6 | M6 删除重排批量 | 大作品性能 |
| 7 | L1–L6 | 维护性/健壮性，按计划治理 |

---

## 附：Lint / 构建门禁（早先一轮已建立，仍有效）

- 校验器 **Biome 2.5.5**（lint + format + assist），`biome.json` 已配置 `preset:"recommended"`、CSS lint 开启、`noInlineStyles` 等 nursery 规则作 warning。
- `package.json` 脚本：`pnpm lint` / `pnpm format` / `pnpm check`。
- 现状：`biome lint` 0 error；`tsc --noEmit` 0 error；非阻塞告警约 1003 warning + 5 info（主要为内联样式、显式类型标注、a11y）。
- 建议 CI 以 `biome lint` / `tsc --noEmit` 0 error 作为门禁。
