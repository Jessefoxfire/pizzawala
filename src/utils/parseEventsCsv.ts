/**
 * Parse CSV for Events Hub import. Supports a header row and quoted fields.
 *
 * Expected columns (header names are case-insensitive; extra columns ignored):
 * title, startDate, endDate, arrivalDate, startTime, endTime, locationName,
 * locationUrl, staffNeeded, notes, staffIds
 *
 * Dates: YYYY-MM-DD. staffIds: optional, separate multiple UIDs with | or ;
 */
export type ParsedEventImportRow = {
  title: string;
  startDate: string;
  endDate: string;
  arrivalDate: string;
  startTime: string;
  endTime: string;
  locationName: string;
  locationUrl: string;
  staffIds: string[];
  staffNeeded: number;
  notes: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normHeader(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

type ColKey = keyof ParsedEventImportRow;

const HEADER_ALIASES: Record<string, ColKey> = {
  title: 'title',
  startdate: 'startDate',
  enddate: 'endDate',
  arrivaldate: 'arrivalDate',
  teamarrivaldate: 'arrivalDate',
  starttime: 'startTime',
  endtime: 'endTime',
  shiftendtime: 'endTime',
  locationname: 'locationName',
  location: 'locationName',
  googlemapslink: 'locationUrl',
  locationurl: 'locationUrl',
  mapslink: 'locationUrl',
  staffneeded: 'staffNeeded',
  peopleneeded: 'staffNeeded',
  notes: 'notes',
  staffids: 'staffIds',
  confirmedstaff: 'staffIds',
};

const DEFAULT_ORDER: (keyof ParsedEventImportRow | 'staffIds')[] = [
  'title',
  'startDate',
  'endDate',
  'arrivalDate',
  'startTime',
  'endTime',
  'locationName',
  'locationUrl',
  'staffNeeded',
  'notes',
  'staffIds',
];

function parseStaffIds(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[|;,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function rowFromCells(
  cells: string[],
  colIndex: Partial<Record<ColKey, number>>
): ParsedEventImportRow | null {
  const get = (key: ColKey) => {
    const idx = colIndex[key];
    if (idx === undefined || idx >= cells.length) return '';
    return cells[idx] ?? '';
  };

  const title = get('title');
  if (!title) return null;

  let startDate = get('startDate');
  let endDate = get('endDate');
  let arrivalDate = get('arrivalDate');
  const startTime = get('startTime');
  const endTime = get('endTime');
  const locationName = get('locationName');
  const locationUrl = get('locationUrl');
  const staffNeededRaw = get('staffNeeded');
  const notes = get('notes');
  const staffIdsRaw = get('staffIds');

  if (!startDate) startDate = endDate || arrivalDate;
  if (!endDate) endDate = startDate;
  if (!arrivalDate) arrivalDate = startDate;

  const staffNeeded = Math.max(1, parseInt(String(staffNeededRaw || '1'), 10) || 1);

  return {
    title,
    startDate,
    endDate,
    arrivalDate,
    startTime,
    endTime,
    locationName,
    locationUrl: locationUrl || '',
    staffIds: parseStaffIds(staffIdsRaw),
    staffNeeded,
    notes,
  };
}

export function parseEventsCsv(raw: string): { rows: ParsedEventImportRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: ParsedEventImportRow[] = [];
  const text = raw.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    errors.push('File is empty.');
    return { rows, errors };
  }

  const firstCells = parseCsvLine(lines[0]);
  const firstNorm = firstCells.map(c => normHeader(c));
  const looksLikeHeader = firstNorm.some(h => h === 'title' || h === 'startdate');

  let colIndex: Partial<Record<ColKey, number>> = {};
  let dataLines: string[];

  if (looksLikeHeader) {
    firstCells.forEach((cell, i) => {
      const key = HEADER_ALIASES[normHeader(cell)];
      if (key) colIndex[key] = i;
    });
    if (colIndex.title === undefined) {
      errors.push('Header row must include a "title" column.');
      return { rows, errors };
    }
    dataLines = lines.slice(1);
  } else {
    DEFAULT_ORDER.forEach((key, i) => {
      colIndex[key as ColKey] = i;
    });
    dataLines = lines;
  }

  dataLines.forEach((line, idx) => {
    const lineNo = idx + (looksLikeHeader ? 2 : 1);
    const cells = parseCsvLine(line);
    const row = rowFromCells(cells, colIndex);
    if (!row) {
      errors.push(`Line ${lineNo}: skipped (empty title).`);
      return;
    }
    const lineErrors: string[] = [];
    if (!DATE_RE.test(row.startDate)) lineErrors.push(`startDate "${row.startDate}" must be YYYY-MM-DD`);
    if (!DATE_RE.test(row.endDate)) lineErrors.push(`endDate "${row.endDate}" must be YYYY-MM-DD`);
    if (!DATE_RE.test(row.arrivalDate)) lineErrors.push(`arrivalDate "${row.arrivalDate}" must be YYYY-MM-DD`);
    if (!row.locationName.trim()) lineErrors.push('locationName is required');
    if (lineErrors.length) {
      lineErrors.forEach(e => errors.push(`Line ${lineNo}: ${e}`));
      return;
    }
    rows.push(row);
  });

  return { rows, errors };
}
