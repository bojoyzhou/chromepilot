import type { ReactNode } from "react";

interface CardProps {
  title: string;
  countText?: string;
  children?: ReactNode;
  headerExtra?: ReactNode;
}

export function Card({ title, countText, children, headerExtra }: CardProps) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        {countText && <span className="card-count">{countText}</span>}
        {headerExtra}
      </div>
      {children}
    </div>
  );
}
