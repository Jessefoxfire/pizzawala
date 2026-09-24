import { jsPDF } from 'jspdf';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { calcBreakMs, calcWorkedMs, getTimestampMs, normalizeShiftPeriods, type LiveShift } from './shifts';

export type TimesheetRow = {
  date: string;
  activity: 'Working' | 'Driving';
  start: string;
  end: string;
  breakMs: number;
  workedMs: number;
};

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ORANGE: [number, number, number] = [232, 133, 57];

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    result += BASE64[(triplet >> 18) & 63] + BASE64[(triplet >> 12) & 63];
    result += i + 1 < bytes.length ? BASE64[(triplet >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? BASE64[triplet & 63] : '=';
  }
  return result;
}

function localDateKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clock(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function duration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function displayDate(key: string) {
  const [year, month, day] = key.split('-');
  return `${day}.${month}.${year}`;
}

function shiftStartMs(shift: LiveShift) {
  const fallback = shift.workPeriods?.[0]?.startIso || shift.breakPeriods?.[0]?.startIso;
  return getTimestampMs(shift.startAt, fallback);
}

/** Build display rows only. Stored shifts are never merged or modified. */
export function buildMonthlyTimesheetRows(shifts: LiveShift[], monthKey: string, nowMs = Date.now()): TimesheetRow[] {
  const grouped = new Map<string, { start: number; end: number; breakMs: number; workedMs: number }>();
  shifts.forEach(shift => {
    if (shift.isScheduled) return;
    const started = shiftStartMs(shift);
    if (!started || localDateKey(started).slice(0, 7) !== monthKey) return;
    const { workPeriods } = normalizeShiftPeriods(shift, nowMs);
    if (!workPeriods.length) return;
    const category: TimesheetRow['activity'] = shift.workCategory === 'driving' ? 'Driving' : 'Working';
    const key = `${localDateKey(started)}:${category}`;
    const first = Math.min(...workPeriods.map(p => new Date(p.startIso).getTime()).filter(Number.isFinite));
    const last = Math.max(...workPeriods.map(p => (p.endIso ? new Date(p.endIso).getTime() : nowMs)).filter(Number.isFinite));
    if (!Number.isFinite(first) || !Number.isFinite(last)) return;
    const current = grouped.get(key);
    grouped.set(key, {
      start: current ? Math.min(current.start, first) : first,
      end: current ? Math.max(current.end, last) : last,
      breakMs: (current?.breakMs || 0) + (category === 'Working' ? calcBreakMs(shift, nowMs) : 0),
      workedMs: (current?.workedMs || 0) + calcWorkedMs(shift, nowMs),
    });
  });
  return Array.from(grouped.entries())
    .map(([key, value]) => {
      const [date, activity] = key.split(':') as [string, TimesheetRow['activity']];
      return { date, activity, start: clock(value.start), end: clock(value.end), breakMs: value.breakMs, workedMs: value.workedMs };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.activity.localeCompare(b.activity));
}

export function buildMonthlyTimesheetPdfBase64(employeeName: string, monthKey: string, rows: TimesheetRow[]) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const margin = 15;
  const col = [31, 29, 27, 27, 25, 35];
  const tableRight = margin + col.reduce((total, value) => total + value, 0);
  const headers = ['Date', 'Activity', 'Start', 'End', 'Break', 'Working time'];
  const monthLabel = new Date(`${monthKey}-01T12:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  let y = 18;
  const drawPageHeader = () => {
    pdf.setFillColor(...ORANGE);
    pdf.rect(margin, y, 10, 2, 'F');
    y += 11;
    pdf.setTextColor(18, 18, 18);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(23);
    pdf.text('Stundenzettel', margin, y);
    pdf.setFontSize(11);
    pdf.setTextColor(...ORANGE);
    pdf.text('Pizza Wala Berlin', width - margin, y - 1, { align: 'right' });
    y += 9;
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(65, 65, 65);
    pdf.setFontSize(10);
    pdf.text(`Employee: ${employeeName || '—'}`, margin, y);
    pdf.text(`Month: ${monthLabel}`, width - margin, y, { align: 'right' });
    y += 8;
  };
  const drawTableHeader = () => {
    let x = margin;
    pdf.setDrawColor(...ORANGE);
    pdf.setLineWidth(0.4);
    pdf.line(margin, y, tableRight, y);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(20, 20, 20);
    pdf.setFontSize(8.5);
    headers.forEach((header, index) => {
      pdf.text(header, x + col[index] / 2, y + 5, { align: 'center', maxWidth: col[index] - 2 });
      pdf.line(x, y, x, y + 8);
      x += col[index];
    });
    y += 8;
    pdf.line(tableRight, y - 8, tableRight, y);
    pdf.line(margin, y, tableRight, y);
  };
  const drawRow = (values: string[]) => {
    let x = margin;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(30, 30, 30);
    values.forEach((value, index) => {
      pdf.text(value, x + col[index] / 2, y + 5, { align: 'center', maxWidth: col[index] - 2 });
      pdf.setDrawColor(...ORANGE);
      pdf.setLineWidth(0.2);
      pdf.line(x, y, x, y + 8);
      x += col[index];
    });
    pdf.line(tableRight, y, tableRight, y + 8);
    y += 8;
    pdf.setDrawColor(155, 155, 155);
    pdf.setLineWidth(0.18);
    pdf.line(margin, y, tableRight, y);
  };
  drawPageHeader();
  drawTableHeader();
  rows.forEach(row => {
    if (y > 276) {
      pdf.addPage();
      y = 18;
      drawPageHeader();
      drawTableHeader();
    }
    drawRow([displayDate(row.date), row.activity, row.start, row.end, row.activity === 'Driving' ? '—' : duration(row.breakMs), duration(row.workedMs)]);
  });
  const signatureY = Math.max(y + 16, pdf.internal.pageSize.getHeight() - 31);
  if (signatureY > pdf.internal.pageSize.getHeight() - 18) {
    pdf.addPage();
    y = 18;
    drawPageHeader();
  }
  const finalSignatureY = Math.max(y + 16, pdf.internal.pageSize.getHeight() - 31);
  pdf.setDrawColor(...ORANGE);
  pdf.setLineWidth(0.35);
  pdf.line(margin, finalSignatureY, margin + 78, finalSignatureY);
  pdf.line(margin + 102, finalSignatureY, tableRight, finalSignatureY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(65, 65, 65);
  pdf.text('Employee signature', margin, finalSignatureY + 5);
  pdf.text('Date', margin + 102, finalSignatureY + 5);
  const buffer = pdf.output('arraybuffer') as ArrayBuffer;
  if (!buffer?.byteLength) throw new Error('Could not generate the timesheet PDF.');
  return toBase64(buffer);
}

export async function shareMonthlyTimesheetPdf(params: { employeeName: string; monthKey: string; shifts: LiveShift[] }) {
  const rows = buildMonthlyTimesheetRows(params.shifts, params.monthKey);
  const base64 = buildMonthlyTimesheetPdfBase64(params.employeeName, params.monthKey, rows);
  const safeName = params.employeeName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'employee';
  const fileName = `PizzaWala-Stundenzettel-${safeName}-${params.monthKey}.pdf`;
  const directory = RNFS.CachesDirectoryPath || RNFS.TemporaryDirectoryPath;
  if (!directory) throw new Error('Could not access device storage.');
  const path = `${directory}/${fileName}`;
  await RNFS.writeFile(path, base64, 'base64');
  if (!(await RNFS.stat(path)).size) throw new Error('Could not save the timesheet PDF.');
  await Share.open({
    title: 'Pizza Wala Stundenzettel',
    message: Platform.OS === 'android' ? 'Save or open this Stundenzettel PDF' : undefined,
    url: path.startsWith('file://') ? path : `file://${path}`,
    type: 'application/pdf',
    filename: fileName,
    failOnCancel: false,
    showAppsToView: true,
  });
  return { rows, fileName, path };
}
