import { describe, expect, it } from "vitest";
import { countWords, strIsEmpty } from "../base/str";

describe("strIsEmpty", () => {
  it("识别 undefined / null / 空串为空白", () => {
    expect(strIsEmpty(undefined)).toBe(true);
    expect(strIsEmpty(null)).toBe(true);
    expect(strIsEmpty("")).toBe(true);
  });

  it("非空串返回 false", () => {
    expect(strIsEmpty("a")).toBe(false);
    expect(strIsEmpty(" ")).toBe(false);
    expect(strIsEmpty("0")).toBe(false);
  });
});

describe("countWords", () => {
  it("空 / 纯空白返回 0", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });

  it("中文按字形簇计数（不含空白）", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("你 好 世 界")).toBe(4);
  });

  it("emoji 算作一个字形簇", () => {
    expect(countWords("😀")).toBe(1);
    expect(countWords("a😀b")).toBe(3);
  });

  it("英文单词内字母各自计数（与后端 chars().count() 一致）", () => {
    expect(countWords("hello")).toBe(5);
    expect(countWords("hello world")).toBe(10);
  });

  it("组合字符（带声调的 e + 声调符）算一个字形簇", () => {
    const combined = "e\u0301"; // é
    expect(countWords(combined)).toBe(1);
  });
});
