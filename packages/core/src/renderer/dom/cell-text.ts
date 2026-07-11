// Shared by every DOM builder that renders a row cell as text (table.ts,
// stat.ts, accessible-table.ts) -- one place to change the null/undefined
// formatting rule instead of three independent copies drifting apart
// (/simplify Reuse finding).
export function cellText(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}
