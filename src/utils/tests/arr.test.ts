import { describe, expect, it } from "vitest";
import {
  average,
  chunk,
  difference,
  first,
  flatten,
  groupBy,
  intersection,
  last,
  max,
  min,
  partition,
  shuffle,
  sortBy,
  sum,
  sumBy,
  unique,
} from "../base/arr";

describe("unique", () => {
  it("基础去重", () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
    expect(unique(["a", "b", "a"])).toEqual(["a", "b"]);
  });
  it("按 key 去重", () => {
    const arr = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 1, name: "c" },
    ];
    expect(unique(arr, (x) => x.id)).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });
});

describe("chunk", () => {
  it("正常分块", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("size 大于数组长度", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
  it("空数组", () => {
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("partition", () => {
  it("按条件分组", () => {
    const [evens, odds] = partition([1, 2, 3, 4, 5], (n) => n % 2 === 0);
    expect(evens).toEqual([2, 4]);
    expect(odds).toEqual([1, 3, 5]);
  });
});

describe("groupBy", () => {
  it("按 key 分组", () => {
    const arr = [
      { type: "a", v: 1 },
      { type: "b", v: 2 },
      { type: "a", v: 3 },
    ];
    const result = groupBy(arr, (x) => x.type);
    expect(result.a).toHaveLength(2);
    expect(result.b).toHaveLength(1);
  });
});

describe("sum / sumBy / average", () => {
  it("sum 求和", () => {
    expect(sum([1, 2, 3, 4])).toBe(10);
    expect(sum([])).toBe(0);
  });
  it("sumBy 按 key 求和", () => {
    const arr = [{ n: 10 }, { n: 20 }, { n: 30 }];
    expect(sumBy(arr, (x) => x.n)).toBe(60);
  });
  it("average 平均值", () => {
    expect(average([1, 2, 3, 4])).toBe(2.5);
    expect(average([])).toBe(0);
  });
});

describe("max / min", () => {
  it("数字数组", () => {
    expect(max([1, 5, 3, 2, 4])).toBe(5);
    expect(min([1, 5, 3, 2, 4])).toBe(1);
  });
  it("按 key 取最值", () => {
    const arr = [
      { name: "a", score: 80 },
      { name: "b", score: 95 },
      { name: "c", score: 70 },
    ];
    expect(max(arr, (x) => x.score)).toEqual({ name: "b", score: 95 });
    expect(min(arr, (x) => x.score)).toEqual({ name: "c", score: 70 });
  });
  it("空数组返回 undefined", () => {
    expect(max([])).toBeUndefined();
    expect(min([])).toBeUndefined();
  });
});

describe("flatten", () => {
  it("完全展开", () => {
    expect(flatten([1, [2, [3, [4]]]])).toEqual([1, 2, 3, 4]);
  });
  it("指定深度", () => {
    expect(flatten([1, [2, [3]]], 1)).toEqual([1, 2, [3]]);
  });
});

describe("shuffle", () => {
  it("返回相同元素的新数组", () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle(arr);
    expect(result).toHaveLength(5);
    expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
    // 原数组不变
    expect(arr).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("first / last", () => {
  it("获取首尾元素", () => {
    expect(first([1, 2, 3])).toBe(1);
    expect(last([1, 2, 3])).toBe(3);
  });
  it("空数组返回 undefined", () => {
    expect(first([])).toBeUndefined();
    expect(last([])).toBeUndefined();
  });
});

describe("intersection / difference", () => {
  it("交集", () => {
    expect(intersection([1, 2, 3, 4], [2, 4, 6])).toEqual([2, 4]);
  });
  it("差集", () => {
    expect(difference([1, 2, 3, 4], [2, 4])).toEqual([1, 3]);
  });
});

describe("sortBy", () => {
  it("数字升序", () => {
    const arr = [{ n: 3 }, { n: 1 }, { n: 2 }];
    expect(sortBy(arr, (x) => x.n)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });
  it("数字降序", () => {
    const arr = [{ n: 3 }, { n: 1 }, { n: 2 }];
    expect(sortBy(arr, (x) => x.n, "desc")).toEqual([{ n: 3 }, { n: 2 }, { n: 1 }]);
  });
  it("不修改原数组", () => {
    const arr = [{ n: 3 }, { n: 1 }];
    sortBy(arr, (x) => x.n);
    expect(arr).toEqual([{ n: 3 }, { n: 1 }]);
  });
});
