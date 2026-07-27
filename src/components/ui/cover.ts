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
    玄幻: "linear-gradient(135deg, #2faeff 0%, #0c6fb4 100%)",
    仙侠: "linear-gradient(135deg, #36bfa3 0%, #2faeff 100%)",
    都市: "linear-gradient(135deg, #1585ce 0%, #4cb6ff 100%)",
    历史: "linear-gradient(135deg, #e0a64e 0%, #efc483 100%)",
    科幻: "linear-gradient(135deg, #0c3483 0%, #4cb6ff 100%)",
    悬疑: "linear-gradient(135deg, #3d4757 0%, #6b7585 100%)",
    言情: "linear-gradient(135deg, #e0a64e 0%, #fdf6ec 100%)",
    武侠: "linear-gradient(135deg, #d18f2e 0%, #e0a64e 100%)",
    奇幻: "linear-gradient(135deg, #36bfa3 0%, #7be8d4 100%)",
    游戏: "linear-gradient(135deg, #1fa971 0%, #36bfa3 100%)",
  };
  return gradients[genre] ?? gradients.玄幻;
}
