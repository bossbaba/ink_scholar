import { describe, expect, it } from "vitest";
import {
  isArray,
  isBoolean,
  isEmpty,
  isFunction,
  isNil,
  isNumber,
  isPlainObject,
  isPromise,
  isString,
  isValidDate,
} from "../base/is";

describe("isNil", () => {
  it("null / undefined 返回 true", () => {
    expect(isNil(null)).toBe(true);
    expect(isNil(undefined)).toBe(true);
  });
  it("其他值返回 false", () => {
    expect(isNil(0)).toBe(false);
    expect(isNil("")).toBe(false);
    expect(isNil(false)).toBe(false);
  });
});

describe("isString", () => {
  it("字符串返回 true", () => {
    expect(isString("")).toBe(true);
    expect(isString("abc")).toBe(true);
  });
  it("非字符串返回 false", () => {
    expect(isString(123)).toBe(false);
    expect(isString(null)).toBe(false);
  });
});

describe("isNumber", () => {
  it("有限数字返回 true", () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(3.14)).toBe(true);
    expect(isNumber(-100)).toBe(true);
  });
  it("NaN / Infinity 返回 false", () => {
    expect(isNumber(NaN)).toBe(false);
    expect(isNumber(Infinity)).toBe(false);
  });
  it("非数字返回 false", () => {
    expect(isNumber("123")).toBe(false);
  });
});

describe("isBoolean", () => {
  it("布尔值返回 true", () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
  });
  it("非布尔值返回 false", () => {
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean("true")).toBe(false);
  });
});

describe("isFunction", () => {
  it("函数返回 true", () => {
    expect(isFunction(() => {})).toBe(true);
    expect(isFunction(() => {})).toBe(true);
  });
  it("非函数返回 false", () => {
    expect(isFunction({})).toBe(false);
  });
});

describe("isArray", () => {
  it("数组返回 true", () => {
    expect(isArray([])).toBe(true);
    expect(isArray([1, 2, 3])).toBe(true);
  });
  it("非数组返回 false", () => {
    expect(isArray({})).toBe(false);
    expect(isArray("array")).toBe(false);
  });
});

describe("isPlainObject", () => {
  it("普通对象返回 true", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });
  it("非普通对象返回 false", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });
});

describe("isEmpty", () => {
  it("空值返回 true", () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty("")).toBe(true);
    expect(isEmpty([])).toBe(true);
    expect(isEmpty({})).toBe(true);
  });
  it("非空值返回 false", () => {
    expect(isEmpty("a")).toBe(false);
    expect(isEmpty([1])).toBe(false);
    expect(isEmpty({ a: 1 })).toBe(false);
    expect(isEmpty(0)).toBe(false);
  });
});

describe("isValidDate", () => {
  it("有效日期返回 true", () => {
    expect(isValidDate(new Date())).toBe(true);
    expect(isValidDate(new Date("2024-01-01"))).toBe(true);
  });
  it("无效日期返回 false", () => {
    expect(isValidDate(new Date("invalid"))).toBe(false);
    expect(isValidDate("2024-01-01")).toBe(false);
  });
});

describe("isPromise", () => {
  it("Promise 返回 true", () => {
    expect(isPromise(Promise.resolve())).toBe(true);
    expect(isPromise(new Promise(() => {}))).toBe(true);
  });
  it("thenable 返回 true", () => {
    const thenKey = "then";
    const thenable = { [thenKey]: () => {} };
    expect(isPromise(thenable)).toBe(true);
  });
  it("非 Promise 返回 false", () => {
    expect(isPromise({})).toBe(false);
    expect(isPromise(null)).toBe(false);
  });
});
