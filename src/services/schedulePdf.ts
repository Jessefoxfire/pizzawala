import { jsPDF } from 'jspdf';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { buildShiftPlanGrid, type ShiftPlanGrid } from '../utils/shiftPlanGrid';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    result += BASE64_CHARS[(triplet >> 18) & 63];
    result += BASE64_CHARS[(triplet >> 12) & 63];
    result += i + 1 < bytes.length ? BASE64_CHARS[(triplet >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? BASE64_CHARS[triplet & 63] : '=';
  }
  return result;
}

export type ScheduledShiftRow = {
  id?: string;
  userId?: string;
  userName?: string;
  worksiteName?: string;
  date: string;
  startTime?: string;
  endTime?: string;
};

export function formatTime12h(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes}${suffix}`;
}

export function filterScheduledInRange(
  shifts: ScheduledShiftRow[],
  startDate: string,
  endDate: string
): ScheduledShiftRow[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Use YYYY-MM-DD for start and end dates.');
  }
  if (startDate > endDate) {
    throw new Error('Start date must be on or before end date.');
  }
  return shifts
    .filter(s => s.date && s.date >= startDate && s.date <= endDate)
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      const byWorksite = String(a.worksiteName || '').localeCompare(String(b.worksiteName || ''));
      if (byWorksite !== 0) return byWorksite;
      return String(a.userName || '').localeCompare(String(b.userName || ''));
    });
}

function pdfSafeText(value: string) {
  return String(value || '').replace(/[\u2013\u2014]/g, '-');
}

export function buildShiftPlanPdfBase64(grid: ShiftPlanGrid): string {
  const dayCount = Math.max(grid.dayHeaders.length, 1);
  const landscape = dayCount > 4;
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const nameW = 32;
  const usable = pageWidth - margin * 2 - nameW;
  const dayW = usable / dayCount;
  const rowH = 12;
  let y = margin;

  pdf.setFillColor(32, 24, 18);
  pdf.rect(margin, y, pageWidth - margin * 2, 12, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(255, 248, 238);
  pdf.text(pdfSafeText(grid.title), margin + 3, y + 8);
  y += 16;

  const drawHeaderCell = (x: number, w: number, lines: string[]) => {
    pdf.setFillColor(48, 34, 24);
    pdf.setDrawColor(180, 120, 60);
    pdf.rect(x, y, w, 14, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(230, 180, 90);
    lines.forEach((line, index) => {
      pdf.text(pdfSafeText(line), x + 1.5, y + 5 + index * 4, { maxWidth: w - 3 });
    });
  };

  drawHeaderCell(margin, nameW, ['MITARBEITER']);
  grid.dayHeaders.forEach((day, index) => {
    drawHeaderCell(margin + nameW + dayW * index, dayW, [day.weekday, day.dateLabel]);
  });
  y += 14;

  const drawBodyCell = (x: number, w: number, text: string, empty: boolean) => {
    pdf.setFillColor(empty ? 248 : 255, empty ? 244 : 250, empty ? 236 : 242);
    pdf.setDrawColor(180, 140, 90);
    pdf.rect(x, y, w, rowH, 'FD');
    pdf.setFont('helvetica', empty ? 'normal' : 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(empty ? 140 : 40, empty ? 120 : 32, empty ? 100 : 24);
    const parts = pdfSafeText(text).split('\n');
    parts.forEach((line, index) => {
      pdf.text(line, x + 1.5, y + 5 + index * 3.5, { maxWidth: w - 3 });
    });
  };

  for (const row of grid.rows) {
    if (y > pageHeight - 24) {
      pdf.addPage();
      y = margin;
    }
    drawBodyCell(margin, nameW, row.userName, false);
    row.cells.forEach((cell, index) => {
      drawBodyCell(margin + nameW + dayW * index, dayW, cell.label, cell.empty);
    });
    y += rowH;
  }

  if (y > pageHeight - 20) {
    pdf.addPage();
    y = margin;
  }
  pdf.setFillColor(48, 34, 24);
  pdf.setDrawColor(180, 120, 60);
  pdf.rect(margin, y, nameW, 10, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.5);
  pdf.setTextColor(230, 180, 90);
  pdf.text('TAGESBESATZUNG', margin + 1.5, y + 6.5, { maxWidth: nameW - 3 });
  grid.staffing.forEach((item, index) => {
    pdf.rect(margin + nameW + dayW * index, y, dayW, 10, 'FD');
    pdf.text(pdfSafeText(item.label), margin + nameW + dayW * index + 1.5, y + 6.5, { maxWidth: dayW - 3 });
  });

  const buffer = pdf.output('arraybuffer') as ArrayBuffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Could not generate PDF.');
  }
  return arrayBufferToBase64(buffer);
}

export function buildSchedulePdfBase64(
  shifts: ScheduledShiftRow[],
  startDate: string,
  endDate: string,
  options?: { eventName?: string; dayKeys?: string[]; employeeUserId?: string }
): string {
  const dates: string[] = [];
  if (options?.dayKeys?.length) {
    dates.push(...options.dayKeys);
  } else {
    let cursor = startDate;
    let guard = 0;
    while (cursor <= endDate && guard < 366) {
      dates.push(cursor);
      const [year, month, day] = cursor.split('-').map(Number);
      const next = new Date(year, month - 1, day + 1);
      cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      guard += 1;
    }
  }

  const grid = buildShiftPlanGrid({
    eventId: 'export',
    eventName: options?.eventName || 'PizzaWala',
    shifts,
    dayKeys: dates,
    employeeUserId: options?.employeeUserId,
  });
  return buildShiftPlanPdfBase64(grid);
}

function scheduleExportFileName(startDate: string, endDate: string) {
  return `PizzaWala-schedule-${startDate}-to-${endDate}.pdf`;
}

async function writeSchedulePdfToCache(base64: string, startDate: string, endDate: string) {
  const fileName = scheduleExportFileName(startDate, endDate);
  const directory = RNFS.CachesDirectoryPath || RNFS.TemporaryDirectoryPath;
  if (!directory) throw new Error('Could not access device storage.');

  let filePath = `${directory}/${fileName}`;
  if (await RNFS.exists(filePath)) {
    const stamped = fileName.replace(/\.pdf$/i, `-${Date.now()}.pdf`);
    filePath = `${directory}/${stamped}`;
  }

  await RNFS.writeFile(filePath, base64, 'base64');
  const stat = await RNFS.stat(filePath);
  if (!stat.size) {
    await RNFS.unlink(filePath).catch(() => undefined);
    throw new Error('Could not save PDF file.');
  }

  return {
    filePath,
    fileName: filePath.split('/').pop() || fileName,
    fileUri: filePath.startsWith('file://') ? filePath : `file://${filePath}`,
  };
}

async function openPdfShareSheet(params: {
  filePath: string;
  fileUri: string;
  fileName: string;
  title: string;
  message?: string;
}) {
  await Share.open({
    title: params.title,
    message: params.message,
    url: params.fileUri,
    type: 'application/pdf',
    filename: params.fileName,
    failOnCancel: false,
    showAppsToView: true,
  });
}

export function defaultExportRange(shifts: ScheduledShiftRow[]) {
  const dates = shifts.map(s => s.date).filter(Boolean).sort();
  const today = new Date().toISOString().slice(0, 10);
  if (dates.length === 0) {
    return { startDate: today, endDate: today };
  }
  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

/** Open the system share sheet so the user can save/open the PDF. */
export async function downloadSchedulePdfToDevice(params: {
  shifts: ScheduledShiftRow[];
  startDate: string;
  endDate: string;
  eventName?: string;
  dayKeys?: string[];
  employeeUserId?: string;
  grid?: ShiftPlanGrid;
}): Promise<{ filePath: string; fileName: string; savedTo: string }> {
  const filtered = filterScheduledInRange(params.shifts, params.startDate, params.endDate);
  const base64 = params.grid
    ? buildShiftPlanPdfBase64(params.grid)
    : buildSchedulePdfBase64(filtered, params.startDate, params.endDate, {
        eventName: params.eventName,
        dayKeys: params.dayKeys,
        employeeUserId: params.employeeUserId,
      });
  if (!base64) throw new Error('Could not generate PDF.');

  const localFile = await writeSchedulePdfToCache(base64, params.startDate, params.endDate);
  await openPdfShareSheet({
    filePath: localFile.filePath,
    fileUri: localFile.fileUri,
    fileName: localFile.fileName,
    title: 'PizzaWala Schedule PDF',
    message: Platform.OS === 'android' ? 'Save or open this schedule PDF' : undefined,
  });

  return {
    filePath: localFile.filePath,
    fileName: localFile.fileName,
    savedTo: localFile.fileName,
  };
}
