import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ hover, className, children, ...rest }: CardProps) {
  const cls = ["ui-card", hover ? "ui-card--hover" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-card__head">
      <h3 className="ui-card__title">{title}</h3>
      {action ? <div className="ui-card__action">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`ui-card__body ${className ?? ""}`}>{children}</div>;
}
