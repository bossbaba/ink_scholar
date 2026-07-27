/**
 * 数字工具集
 */

/** 将数值限制在 [min, max] 范围内 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 生成 [min, max] 范围内的随机整数（含两端） */
export function randomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 生成 [min, max) 范围内的随机浮点数 */
export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * 格式化字数显示。
 * >= 10000 时显示为 "x.x万"，否则原样输出。
 */
export function formatWordCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  }
  return count.toString();
}

/**
 * 格式化文件大小（字节 → 人类可读）。
 * 自动选择 B / KB / MB / GB 单位。
 */
export function formatFileSize(bytes: number, decimals = 1): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return `${(bytes / k ** i).toFixed(decimals)} ${units[i]}`;
}

/**
 * 格式化数字为千分位字符串。
 * 例：1234567 → "1,234,567"
 */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * 安全解析数字，失败时返回 fallback。
 */
export function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 保留指定小数位（四舍五入），返回数字。
 * 解决 toFixed 返回字符串以及浮点精度问题。
 */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * 判断数值是否在指定范围内（含边界）。
 */
export function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}
