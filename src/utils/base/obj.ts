/**
 * 对象工具集
 */

/** 深拷贝（支持 Date、RegExp、Map、Set、Array、普通对象） */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;

  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;

  if (value instanceof Map) {
    const map = new Map();
    value.forEach((v, k) => {
      map.set(deepClone(k), deepClone(v));
    });
    return map as T;
  }

  if (value instanceof Set) {
    const set = new Set();
    value.forEach((v) => {
      set.add(deepClone(v));
    });
    return set as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  const result = {} as T;
  for (const key of Object.keys(value)) {
    result[key as keyof T] = deepClone(value[key as keyof T]);
  }
  return result;
}

/** 浅合并多个对象（后面的覆盖前面的） */
export function merge<T extends object>(...sources: Partial<T>[]): T {
  return Object.assign({}, ...sources) as T;
}

/** 深合并两个对象（递归合并嵌套对象，数组直接替换） */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal as object, sourceVal as object) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

/** 从对象中选取指定键 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/** 从对象中排除指定键 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/** 安全获取嵌套属性值（类似 lodash.get） */
export function get<T = unknown>(
  obj: unknown,
  path: string | (string | number)[],
  defaultValue?: T,
): T | undefined {
  const keys = Array.isArray(path) ? path : path.split(".").flatMap((k) => k.split(/\[(\d+)\]/u));
  let result: unknown = obj;
  for (const key of keys) {
    if (key === "") continue;
    if (result === null || result === undefined) return defaultValue;
    result = (result as Record<string, unknown>)[key];
  }
  return result === undefined ? defaultValue : (result as T);
}

/** 判断对象是否具有指定属性（含原型链） */
export function has(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

/** 获取对象所有键（含 Symbol） */
export function keys(obj: object): (string | symbol)[] {
  return [...Object.keys(obj), ...Object.getOwnPropertySymbols(obj)];
}

/** 将对象转换为 [key, value] 数组 */
export function entries<T extends object>(obj: T): [keyof T, T[keyof T]][] {
  return Object.entries(obj) as [keyof T, T[keyof T]][];
}

/** 从 [key, value] 数组构建对象 */
export function fromEntries<K extends string | number | symbol, V>(
  entries: [K, V][],
): Record<K, V> {
  return Object.fromEntries(entries) as Record<K, V>;
}

/** 过滤对象属性（返回满足条件的新对象） */
export function filterObject<T extends object>(
  obj: T,
  predicate: (value: T[keyof T], key: keyof T) => boolean,
): Partial<T> {
  const result = {} as Partial<T>;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (predicate(obj[key], key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/** 映射对象值（返回新对象） */
export function mapValues<T extends object, R>(
  obj: T,
  fn: (value: T[keyof T], key: keyof T) => R,
): Record<keyof T, R> {
  const result = {} as Record<keyof T, R>;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    result[key] = fn(obj[key], key);
  }
  return result;
}
