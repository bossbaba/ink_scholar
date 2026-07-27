export const GENRES: { value: string; label: string; icon: string }[] = [
  { value: "玄幻", label: "玄幻", icon: "玄" },
  { value: "仙侠", label: "仙侠", icon: "仙" },
  { value: "都市", label: "都市", icon: "都" },
  { value: "历史", label: "历史", icon: "史" },
  { value: "科幻", label: "科幻", icon: "科" },
  { value: "悬疑", label: "悬疑", icon: "悬" },
  { value: "言情", label: "言情", icon: "言" },
  { value: "武侠", label: "武侠", icon: "武" },
  { value: "奇幻", label: "奇幻", icon: "奇" },
  { value: "游戏", label: "游戏", icon: "游" },
];

export function getGenreIcon(genre: string): string {
  return GENRES.find((g) => g.value === genre)?.icon ?? "文";
}

export function getCoverGradient(genre: string): string {
  const gradients: Record<string, string> = {
    玄幻: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    仙侠: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    都市: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
    历史: "linear-gradient(135deg, #C9A96E 0%, #E8D5A8 100%)",
    科幻: "linear-gradient(135deg, #0c3483 0%, #a2b6df 100%)",
    悬疑: "linear-gradient(135deg, #434343 0%, #6B7585 100%)",
    言情: "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)",
    武侠: "linear-gradient(135deg, #E08A5B 0%, #F5C89A 100%)",
    奇幻: "linear-gradient(135deg, #9B8EC4 0%, #C8B8E8 100%)",
    游戏: "linear-gradient(135deg, #36BFA3 0%, #7BE8D4 100%)",
  };
  return gradients[genre] ?? gradients.玄幻;
}
