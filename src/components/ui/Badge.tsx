import type { ReactNode } from "react";

export type BadgeTone = "blue" | "teal" | "green" | "amber" | "gray";

export function Badge({ tone = "blue", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge is-${tone}`}>{children}</span>;
}
