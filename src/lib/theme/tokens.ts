// Kreader 三套主题，色值取自设计原型（和纸 / 夜空 / 抹茶）。
// 以 CSS 变量驱动，切换主题只换一组变量。

export interface ThemeTokens {
  app: string;
  page: string;
  ink: string;
  ink2: string;
  line: string;
  acc: string;
  soft: string;
}

export type ThemeId = "paper" | "night" | "matcha";

export const THEMES: Record<ThemeId, ThemeTokens & { name: string }> = {
  paper: {
    name: "和纸",
    app: "#E8E0CE", page: "#FBF6EA", ink: "#2A241C", ink2: "#8A7E69",
    line: "#E2D8C2", acc: "#B23A2A", soft: "#F4EDDC",
  },
  night: {
    name: "夜空",
    app: "#13151B", page: "#1F222A", ink: "#D9D2C2", ink2: "#8E8A7C",
    line: "#343843", acc: "#D07A52", soft: "#272B34",
  },
  matcha: {
    name: "抹茶",
    app: "#DCE3D0", page: "#F4F7EA", ink: "#2C3324", ink2: "#75805F",
    line: "#D5DCBF", acc: "#5F7D3F", soft: "#EAF0DA",
  },
};

export function themeVars(id: ThemeId): Record<string, string> {
  const t = THEMES[id];
  return {
    "--app": t.app, "--page": t.page, "--ink": t.ink, "--ink2": t.ink2,
    "--line": t.line, "--acc": t.acc, "--soft": t.soft,
  };
}
