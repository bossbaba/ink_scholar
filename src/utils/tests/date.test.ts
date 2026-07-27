import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daysBetween,
  endOfDay,
  formatDate,
  formatDateCN,
  isSameDay,
  parseDate,
  relativeDay,
  relativeTime,
  startOfDay,
} from "../base/date";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseDate", () => {
  it("解析有效日期字符串", () => {
    const d = parseDate("2024-03-15T10:30:00Z") as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2024);
  });
  it("解析时间戳", () => {
    const ts = 1710500000000;
    const d = parseDate(ts);
    expect(d).toBeInstanceOf(Date);
  });
  it("无效输入返回 null", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("invalid")).toBeNull();
    expect(parseDate(new Date("invalid"))).toBeNull();
  });
});

describe("formatDate", () => {
  it("默认格式", () => {
    const d = new Date(2024, 2, 15, 10, 30, 45); // 2024-03-15 10:30:45
    expect(formatDate(d)).toBe("2024-03-15 10:30:45");
  });
  it("自定义格式", () => {
    const d = new Date(2024, 2, 15, 10, 30, 45);
    expect(formatDate(d, "YYYY/MM/DD")).toBe("2024/03/15");
    expect(formatDate(d, "HH:mm")).toBe("10:30");
  });
  it("无效日期返回 未知时间", () => {
    expect(formatDate("invalid")).toBe("未知时间");
  });
});

describe("formatDateCN", () => {
  it("格式化为中文日期", () => {
    const d = new Date(2024, 2, 15);
    const result = formatDateCN(d);
    expect(result).toContain("2024");
    expect(result).toContain("3");
    expect(result).toContain("15");
  });
});

describe("relativeTime", () => {
  it("刚刚", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15T10:00:00Z"));
    expect(relativeTime("2024-03-15T09:59:30Z")).toBe("刚刚");
  });
  it("x分钟前", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15T10:00:00Z"));
    expect(relativeTime("2024-03-15T09:30:00Z")).toBe("30分钟前");
  });
  it("x小时前", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15T10:00:00Z"));
    expect(relativeTime("2024-03-15T07:00:00Z")).toBe("3小时前");
  });
  it("x天前", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15T10:00:00Z"));
    expect(relativeTime("2024-03-13T10:00:00Z")).toBe("2天前");
  });
  it("超过7天显示日期", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15T10:00:00Z"));
    const result = relativeTime("2024-03-01T10:00:00Z");
    expect(result).toContain("3月");
  });
});

describe("relativeDay", () => {
  it("今天", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15T10:00:00Z"));
    expect(relativeDay("2024-03-15T08:00:00Z")).toBe("今天");
  });
  it("昨天", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 2, 15, 10, 0, 0)); // 本地时间
    expect(relativeDay(new Date(2024, 2, 14, 20, 0, 0))).toBe("昨天");
  });
  it("x天前", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15T10:00:00Z"));
    expect(relativeDay("2024-03-12T10:00:00Z")).toBe("3天前");
  });
});

describe("isSameDay", () => {
  it("同一天返回 true", () => {
    // 使用本地时间避免时区问题
    expect(isSameDay(new Date(2024, 2, 15, 8, 0, 0), new Date(2024, 2, 15, 20, 0, 0))).toBe(true);
  });
  it("不同天返回 false", () => {
    expect(isSameDay("2024-03-15", "2024-03-16")).toBe(false);
  });
});

describe("startOfDay / endOfDay", () => {
  it("startOfDay 返回当天 00:00:00", () => {
    const d = startOfDay("2024-03-15T15:30:00") as Date;
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
  it("endOfDay 返回当天 23:59:59", () => {
    const d = endOfDay("2024-03-15T15:30:00") as Date;
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
  });
});

describe("daysBetween", () => {
  it("计算天数差", () => {
    expect(daysBetween("2024-03-15", "2024-03-10")).toBe(5);
    expect(daysBetween("2024-03-10", "2024-03-15")).toBe(5);
  });
  it("无效日期返回 0", () => {
    expect(daysBetween("invalid", "2024-03-15")).toBe(0);
  });
});
