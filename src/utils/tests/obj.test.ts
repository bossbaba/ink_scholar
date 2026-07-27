import { describe, expect, it } from "vitest";
import {
  deepClone,
  deepMerge,
  entries,
  filterObject,
  fromEntries,
  get,
  has,
  keys,
  mapValues,
  merge,
  omit,
  pick,
} from "../base/obj";

describe("deepClone", () => {
  it("深拷贝嵌套对象", () => {
    const obj = { a: 1, b: { c: 2, d: [3, 4] } };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    cloned.b.c = 999;
    expect(obj.b.c).toBe(2);
  });
  it("拷贝 Date", () => {
    const d = new Date("2024-01-01");
    const cloned = deepClone(d);
    expect(cloned).toEqual(d);
    expect(cloned).not.toBe(d);
  });
  it("拷贝 Map / Set", () => {
    const map = new Map([["a", 1]]);
    const set = new Set([1, 2, 3]);
    expect(deepClone(map)).toEqual(map);
    expect(deepClone(set)).toEqual(set);
  });
  it("基本类型直接返回", () => {
    expect(deepClone(123)).toBe(123);
    expect(deepClone("str")).toBe("str");
    expect(deepClone(null)).toBeNull();
  });
});

describe("merge", () => {
  it("浅合并对象", () => {
    const result = merge<{ a: number; b?: number }>({ a: 1 }, { b: 2 }, { a: 3 });
    expect(result).toEqual({ a: 3, b: 2 });
  });
});

describe("deepMerge", () => {
  it("递归合并嵌套对象", () => {
    interface TestObj {
      a: number;
      b: { c: number; d?: number; e?: number };
    }
    const target: TestObj = { a: 1, b: { c: 2, d: 3 } };
    const source: Partial<TestObj> = { b: { c: 99, e: 5 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1, b: { c: 99, d: 3, e: 5 } });
  });
  it("数组直接替换", () => {
    const target = { arr: [1, 2, 3] };
    const source = { arr: [4, 5] };
    expect(deepMerge(target, source)).toEqual({ arr: [4, 5] });
  });
});

describe("pick", () => {
  it("选取指定键", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });
  it("不存在的键忽略", () => {
    const obj = { a: 1 };
    expect(pick(obj, ["a", "b" as keyof typeof obj])).toEqual({ a: 1 });
  });
});

describe("omit", () => {
  it("排除指定键", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["b"])).toEqual({ a: 1, c: 3 });
  });
});

describe("get", () => {
  it("点号路径", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(get(obj, "a.b.c")).toBe(42);
  });
  it("数组索引路径", () => {
    const obj = { arr: [{ name: "test" }] };
    expect(get(obj, "arr[0].name")).toBe("test");
  });
  it("路径不存在返回默认值", () => {
    const obj = { a: 1 };
    expect(get(obj, "b.c", "default")).toBe("default");
    expect(get(obj, "b.c")).toBeUndefined();
  });
  it("数组路径", () => {
    const obj = { a: { b: [1, 2, 3] } };
    expect(get(obj, ["a", "b", 1])).toBe(2);
  });
});

describe("has", () => {
  it("存在属性返回 true", () => {
    expect(has({ a: 1 }, "a")).toBe(true);
  });
  it("不存在返回 false", () => {
    expect(has({ a: 1 }, "b")).toBe(false);
  });
});

describe("keys", () => {
  it("返回字符串和 Symbol 键", () => {
    const sym = Symbol("test");
    const obj = { a: 1, [sym]: 2 };
    const result = keys(obj);
    expect(result).toContain("a");
    expect(result).toContain(sym);
  });
});

describe("entries / fromEntries", () => {
  it("对象转 entries", () => {
    const obj = { a: 1, b: 2 };
    expect(entries(obj)).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });
  it("entries 转对象", () => {
    const arr: [string, number][] = [
      ["a", 1],
      ["b", 2],
    ];
    expect(fromEntries(arr)).toEqual({ a: 1, b: 2 });
  });
});

describe("filterObject", () => {
  it("过滤属性", () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = filterObject(obj, (v) => (v as number) > 1);
    expect(result).toEqual({ b: 2, c: 3 });
  });
});

describe("mapValues", () => {
  it("映射值", () => {
    const obj = { a: 1, b: 2 };
    const result = mapValues(obj, (v) => (v as number) * 2);
    expect(result).toEqual({ a: 2, b: 4 });
  });
});
