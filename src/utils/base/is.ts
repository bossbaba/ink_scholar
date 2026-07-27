/**
 * 类型守卫 & 类型判断工具集
 */

/** 判断值是否为 null 或 undefined */
export function isNil(v: unknown): v is null | undefined {
  return v === null || v === undefined;
}

/** 判断值是否为字符串 */
export function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** 判断值是否为有限数字（排除 NaN / Infinity） */
export function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 判断值是否为布尔值 */
export function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

/** 判断值是否为函数 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function isFunction(v: unknown): v is (...args: unknown[]) => unknown {
  return typeof v === "function";
}

/** 判断值是否为数组 */
export function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** 判断值是否为普通对象（排除 null、数组、Date 等） */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Object.prototype.toString.call(v) === "[object Object]";
}

/** 判断值是否为空（null/undefined/空串/空数组/空对象） */
export function isEmpty(v: unknown): boolean {
  if (isNil(v)) return true;
  if (isString(v) || isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.keys(v).length === 0;
  return false;
}

/** 判断值是否为有效日期 */
export function isValidDate(v: unknown): v is Date {
  return v instanceof Date && !Number.isNaN(v.getTime());
}

/** 判断值是否为 Promise-like（thenable） */
export function isPromise<T = unknown>(v: unknown): v is Promise<T> {
  return (
    v instanceof Promise ||
    (v !== null && typeof v === "object" && typeof (v as Promise<T>).then === "function")
  );
}
