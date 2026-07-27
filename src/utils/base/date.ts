/**
 * 日期时间工具集
 */

/**
 * 安全解析日期字符串/时间戳为 Date 对象。
 * 解析失败返回 null。
 */
export function parseDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 格式化日期为指定格式字符串。
 * 支持占位符：YYYY / MM / DD / HH / mm / ss
 * 默认格式 "YYYY-MM-DD HH:mm:ss"
 */
export function formatDate(date: Date | string | number, format = "YYYY-MM-DD HH:mm:ss"): string {
  const d = parseDate(date);
  if (!d) return "未知时间";

  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: String(d.getMonth() + 1).padStart(2, "0"),
    DD: String(d.getDate()).padStart(2, "0"),
    HH: String(d.getHours()).padStart(2, "0"),
    mm: String(d.getMinutes()).padStart(2, "0"),
    ss: String(d.getSeconds()).padStart(2, "0"),
  };

  return format.replace(/YYYY|MM|DD|HH|mm|ss/gu, (match) => tokens[match]);
}

/**
 * 将日期格式化为中文友好显示。
 * 例：2024年3月15日
 */
export function formatDateCN(date: Date | string | number): string {
  const d = parseDate(date);
  if (!d) return "未知时间";
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * 相对时间描述（中文）。
 * - < 1 分钟 → "刚刚"
 * - < 60 分钟 → "x分钟前"
 * - < 24 小时 → "x小时前"
 * - < 7 天 → "x天前"
 * - 否则 → "x月x日"
 */
export function relativeTime(date: Date | string | number): string {
  const d = parseDate(date);
  if (!d) return "未知时间";

  const now = Date.now();
  const diff = now - d.getTime();

  if (diff < 0) return "刚刚";

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/**
 * 简化版相对日期（天级别）。
 * - 0 天 → "今天"
 * - 1 天 → "昨天"
 * - < 7 天 → "x天前"
 * - 否则 → "x月x日"
 */
export function relativeDay(date: Date | string | number): string {
  const d = parseDate(date);
  if (!d) return "未知时间";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;

  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/**
 * 判断两个日期是否为同一天。
 */
export function isSameDay(a: Date | string | number, b: Date | string | number): boolean {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!(da && db)) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * 获取某天的起始时间（00:00:00.000）。
 */
export function startOfDay(date: Date | string | number): Date | null {
  const d = parseDate(date);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 获取某天的结束时间（23:59:59.999）。
 */
export function endOfDay(date: Date | string | number): Date | null {
  const d = parseDate(date);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * 计算两个日期之间相差的天数（取绝对值）。
 */
export function daysBetween(a: Date | string | number, b: Date | string | number): number {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!(da && db)) return 0;
  const diff = Math.abs(da.getTime() - db.getTime());
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
