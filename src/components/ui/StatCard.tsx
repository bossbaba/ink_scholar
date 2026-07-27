import type { ReactNode } from "react";

export type StatTone = "blue" | "teal" | "green" | "amber";

interface StatCardProps {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  tone?: StatTone;
  trend?: { value: string; direction: "up" | "down" };
}

export function StatCard({ icon, value, label, tone = "blue", trend }: StatCardProps) {
  return (
    <div className="ui-stat">
      <div className="ui-stat__top">
        <div className={`ui-stat__icon is-${tone}`}>{icon}</div>
        {trend ? (
          <span className={`ui-stat__trend is-${trend.direction}`}>{trend.value}</span>
        ) : null}
      </div>
      <div className="ui-stat__value">{value}</div>
      <div className="ui-stat__label">{label}</div>
    </div>
  );
}
