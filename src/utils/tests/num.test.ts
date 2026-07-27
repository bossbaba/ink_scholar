import { describe, expect, it } from "vitest";
import {
  clamp,
  formatFileSize,
  formatNumber,
  formatWordCount,
  inRange,
  randomFloat,
  randomInt,
  round,
  toNumber,
} from "../base/num";

describe("clamp", () => {
  it("值在范围内不变", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("值小于 min 返回 min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it("值大于 max 返回 max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("randomInt", () => {
  it("生成范围内的整数", () => {
    for (let i = 0; i < 100; i++) {
      const n = randomInt(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});

describe("randomFloat", () => {
  it("生成范围内的浮点数", () => {
    for (let i = 0; i < 100; i++) {
      const n = randomFloat(0, 1);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe("formatWordCount", () => {
  it("小于 10000 原样输出", () => {
    expect(formatWordCount(0)).toBe("0");
    expect(formatWordCount(999)).toBe("999");
    expect(formatWordCount(9999)).toBe("9999");
  });
  it("大于等于 10000 显示为万", () => {
    expect(formatWordCount(10000)).toBe("1.0万");
    expect(formatWordCount(15000)).toBe("1.5万");
    expect(formatWordCount(123456)).toBe("12.3万");
  });
});

describe("formatFileSize", () => {
  it("0 或负数返回 0 B", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(-100)).toBe("0 B");
  });
  it("正确转换单位", () => {
    expect(formatFileSize(512)).toBe("512.0 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
});

describe("formatNumber", () => {
  it("添加千分位", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(999)).toBe("999");
  });
});

describe("toNumber", () => {
  it("有效数字字符串", () => {
    expect(toNumber("123")).toBe(123);
    expect(toNumber("3.14")).toBe(3.14);
  });
  it("无效值返回 fallback", () => {
    expect(toNumber("abc")).toBe(0);
    expect(toNumber("abc", -1)).toBe(-1);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });
});

describe("round", () => {
  it("四舍五入到整数", () => {
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: 取整测试用的固定浮点输入
    expect(round(3.14159)).toBe(3);
    expect(round(3.5)).toBe(4);
  });
  it("保留指定小数位", () => {
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: 保留小数位测试用的固定浮点输入
    expect(round(3.14159, 2)).toBe(3.14);
    expect(round(3.145, 2)).toBe(3.15);
  });
});

describe("inRange", () => {
  it("值在范围内返回 true", () => {
    expect(inRange(5, 0, 10)).toBe(true);
    expect(inRange(0, 0, 10)).toBe(true);
    expect(inRange(10, 0, 10)).toBe(true);
  });
  it("值不在范围内返回 false", () => {
    expect(inRange(-1, 0, 10)).toBe(false);
    expect(inRange(11, 0, 10)).toBe(false);
  });
});
