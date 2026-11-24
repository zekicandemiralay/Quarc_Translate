// "Today", "Yesterday", "Mon 3 Nov" — headings for the history list.

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** @returns {'today' | 'yesterday' | string} a key for today/yesterday, otherwise the formatted date */
export function dayHeading(iso, locale, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(d);
}

/** Groups consecutive entries (already newest first) by their day heading. */
export function groupByDay(entries, locale, now = new Date()) {
  const groups = [];
  for (const entry of entries) {
    const heading = dayHeading(entry.updated_at || entry.created_at, locale, now);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.entries.push(entry);
    else groups.push({ heading, entries: [entry] });
  }
  return groups;
}

export function timeOf(iso, locale) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
}
