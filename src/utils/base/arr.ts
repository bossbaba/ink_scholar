/**
 * 数组工具集
 */

/** 数组去重（基于引用相等或自定义 key） */
export function unique<T>(arr: T[], keyFn?: (item: T) => unknown): T[] {
  if (!keyFn) return [...new Set(arr)];
  const seen = new Set<unknown>();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 将数组按指定大小分块 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/** 按条件将数组分为两组：[满足条件的, 不满足条件的] */
export function partition<T>(arr: T[], predicate: (item: T, index: number) => boolean): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  arr.forEach((item, index) => {
    if (predicate(item, index)) {
      pass.push(item);
    } else {
      fail.push(item);
    }
  });
  return [pass, fail];
}

/** 按 key 函数对数组元素分组 */
export function groupBy<T, K extends string | number>(
  arr: T[],
  keyFn: (item: T) => K,
): Record<K, T[]> {
  return arr.reduce(
    (acc, item) => {
      const key = keyFn(item);
      if (!(key in acc)) acc[key] = [];
      acc[key].push(item);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}

/** 数组求和 */
export function sum(arr: number[]): number {
  return arr.reduce((acc, n) => acc + n, 0);
}

/** 数组求和（通过 key 函数提取数值） */
export function sumBy<T>(arr: T[], keyFn: (item: T) => number): number {
  return arr.reduce((acc, item) => acc + keyFn(item), 0);
}

/** 数组平均值 */
export function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return sum(arr) / arr.length;
}

/** 获取数组最大值 */
export function max<T>(arr: T[], keyFn?: (item: T) => number): T | undefined {
  if (arr.length === 0) return;
  if (!keyFn)
    return arr.reduce((a, b) => ((a as unknown as number) >= (b as unknown as number) ? a : b));
  return arr.reduce((a, b) => (keyFn(a) >= keyFn(b) ? a : b));
}

/** 获取数组最小值 */
export function min<T>(arr: T[], keyFn?: (item: T) => number): T | undefined {
  if (arr.length === 0) return;
  if (!keyFn)
    return arr.reduce((a, b) => ((a as unknown as number) <= (b as unknown as number) ? a : b));
  return arr.reduce((a, b) => (keyFn(a) <= keyFn(b) ? a : b));
}

/** 数组扁平化（指定深度，默认完全展开） */
export function flatten<T>(arr: unknown[], depth = Infinity): T[] {
  return arr.flat(depth) as T[];
}

/** 数组乱序（Fisher-Yates 洗牌算法，返回新数组） */
export function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 获取数组最后一个元素 */
export function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

/** 获取数组第一个元素 */
export function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

/** 数组交集 */
export function intersection<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter((item) => setB.has(item));
}

/** 数组差集（a 中有但 b 中没有的） */
export function difference<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter((item) => !setB.has(item));
}

/** 按 key 排序数组（返回新数组），order: 'asc' | 'desc' */
export function sortBy<T>(
  arr: T[],
  keyFn: (item: T) => number | string,
  order: "asc" | "desc" = "asc",
): T[] {
  const result = [...arr];
  result.sort((a, b) => {
    const va = keyFn(a);
    const vb = keyFn(b);
    const cmp =
      typeof va === "string" && typeof vb === "string"
        ? va.localeCompare(vb, "zh-CN")
        : (va as number) - (vb as number);
    return order === "asc" ? cmp : -cmp;
  });
  return result;
}
