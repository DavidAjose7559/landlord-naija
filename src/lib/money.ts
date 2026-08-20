// All money in this app is INTEGER CENTS. No floats, no decimals, ever.

export function formatCAD(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${sign}$${formatted}`;
}

export function dollars(n: number): number {
  return n * 100;
}
