/** RFC 4180 CSV with a header row. Formula-looking cells are prefixed so Excel doesn't run them. */
export function toCsv(rows: Record<string, string | number | boolean | null>[], columns: string[]): string {
  const cell = (v: string | number | boolean | null): string => {
    if (v === null) return ''
    let s = String(v)
    if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c] ?? null)).join(','))].join('\r\n') + '\r\n'
}
