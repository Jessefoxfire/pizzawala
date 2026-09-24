function timestampMs(raw: unknown, fallbackIso?: string | null) {
  if (raw && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (raw as { toDate: () => Date }).toDate().getTime();
    } catch {
      // fall through
    }
  }
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (fallbackIso) {
    const parsed = new Date(fallbackIso).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function monthKeyFromDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function temperatureLogMonthKey(item: {
  monthKey?: string | null;
  dateKey?: string | null;
  loggedAt?: unknown;
  loggedAtIso?: string | null;
}) {
  const month = String(item.monthKey || '').trim();
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  const dateKey = String(item.dateKey || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey.slice(0, 7);
  const ms = timestampMs(item.loggedAt, item.loggedAtIso);
  if (!ms) return '';
  return monthKeyFromDate(new Date(ms));
}

export function groupTemperatureLogYears(logs: Array<Parameters<typeof temperatureLogMonthKey>[0]>) {
  const years = new Map<string, number>();
  for (const log of logs) {
    const month = temperatureLogMonthKey(log);
    if (!month) continue;
    const year = month.slice(0, 4);
    years.set(year, (years.get(year) || 0) + 1);
  }
  return Array.from(years.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

export function groupTemperatureLogMonths(
  logs: Array<Parameters<typeof temperatureLogMonthKey>[0]>,
  year?: string | null
) {
  const months = new Map<string, number>();
  for (const log of logs) {
    const month = temperatureLogMonthKey(log);
    if (!month) continue;
    if (year && month.slice(0, 4) !== year) continue;
    months.set(month, (months.get(month) || 0) + 1);
  }
  return Array.from(months.entries())
    .map(([monthKey, count]) => ({ monthKey, count }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

export function groupTemperatureLogsByMonth<T extends Parameters<typeof temperatureLogMonthKey>[0]>(logs: T[]) {
  const buckets = new Map<string, T[]>();
  for (const log of logs) {
    const month = temperatureLogMonthKey(log) || 'unknown';
    const list = buckets.get(month) ?? [];
    list.push(log);
    buckets.set(month, list);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([monthKey, items]) => ({ monthKey, items }));
}

export function filterTemperatureLogsForMonth<T extends Parameters<typeof temperatureLogMonthKey>[0]>(
  logs: T[],
  monthKey: string
) {
  return logs.filter(log => temperatureLogMonthKey(log) === monthKey);
}

export function temperatureLogYear(item: Parameters<typeof temperatureLogMonthKey>[0]) {
  const month = temperatureLogMonthKey(item);
  return month && month !== 'unknown' ? month.slice(0, 4) : '';
}

export function splitLogsByCalendarYear<T extends Parameters<typeof temperatureLogMonthKey>[0]>(logs: T[]) {
  const years = new Map<string, T[]>();
  for (const log of logs) {
    const year = temperatureLogYear(log);
    if (!year) continue;
    const list = years.get(year) ?? [];
    list.push(log);
    years.set(year, list);
  }
  const sortedYears = Array.from(years.keys()).sort((a, b) => b.localeCompare(a));
  const currentYear = sortedYears[0] || null;
  return {
    currentYear,
    currentLogs: currentYear ? years.get(currentYear) || [] : [],
    previousYears: sortedYears.slice(1).map(year => ({
      year,
      items: years.get(year) || [],
    })),
  };
}

export function formatHygieneMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}
