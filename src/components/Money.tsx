import { formatCAD } from "@/lib/money";

interface MoneyProps {
  cents: number;
  className?: string;
}

// The one place money ever gets rendered — tabular-nums always, so a
// column of numbers never jitters as figures change.
export function Money({ cents, className }: MoneyProps) {
  return <span className={`tabular-nums ${className ?? ""}`}>{formatCAD(cents)}</span>;
}
