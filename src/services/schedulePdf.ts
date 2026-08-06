import { jsPDF } from 'jspdf';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import { auth, nativeAuth } from './firebase';

const UPLOAD_SCHEDULE_EXPORT_URL =
  'https://us-central1-pizza-wala-team.cloudfunctions.net/uploadScheduleExport';

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

export function formatDateLong(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatPeriodLabel(startDate: string, endDate: string) {
  if (startDate === endDate) return formatDateLong(startDate);
  return `${formatDateLong(startDate)} – ${formatDateLong(endDate)}`;
}

function groupByDate(shifts: ScheduledShiftRow[]) {
  const map = new Map<string, ScheduledShiftRow[]>();
  shifts.forEach(shift => {
    const list = map.get(shift.date) ?? [];
    list.push(shift);
    map.set(shift.date, list);
  });
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function buildSchedulePdfBase64(
  shifts: ScheduledShiftRow[],
  startDate: string,
  endDate: string
): string {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 14;
  const pageWidth = pdf.internal.pageSize.getWidth();
  let y = margin;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(30, 24, 19);
  pdf.text('PizzaWala Schedule', margin, y);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(201, 120, 43);
  y += 9;
  pdf.text(formatPeriodLabel(startDate, endDate), margin, y);

  pdf.setFontSize(9);
  pdf.setTextColor(120, 100, 80);
  y += 6;
  pdf.text(
    `Generated ${new Date().toLocaleString()} • ${shifts.length} shift${shifts.length === 1 ? '' : 's'}`,
    margin,
    y
  );

  y += 10;
  pdf.setDrawColor(201, 120, 43);
  pdf.setLineWidth(0.4);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 8;

  if (shifts.length === 0) {
    pdf.setFontSize(11);
    pdf.setTextColor(60, 50, 40);
    pdf.text('No scheduled shifts in this period.', margin, y);
    const buffer = pdf.output('arraybuffer') as ArrayBuffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('Could not generate PDF.');
    }
    return arrayBufferToBase64(buffer);
  }

  for (const [dateKey, rows] of groupByDate(shifts)) {
    if (y > 265) {
      pdf.addPage();
      y = margin;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(30, 24, 19);
    pdf.text(formatDateLong(dateKey), margin, y);
    y += 6;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(50, 45, 40);

    for (const row of rows) {
      if (y > 282) {
        pdf.addPage();
        y = margin;
      }
      const employee = row.userName || 'Team member';
      const worksite = row.worksiteName || 'Worksite';
      const time =
        row.startTime && row.endTime
          ? `${formatTime12h(row.startTime)} – ${formatTime12h(row.endTime)}`
          : row.startTime || '—';
      pdf.text(`• ${employee}`, margin + 2, y);
      y += 5;
      pdf.setTextColor(90, 80, 70);
      pdf.text(`  ${worksite}  •  ${time}`, margin + 2, y);
      pdf.setTextColor(50, 45, 40);
      y += 7;
    }
    y += 3;
  }

  pdf.setFontSize(8);
  pdf.setTextColor(130, 110, 95);
  const footerY = pdf.internal.pageSize.getHeight() - 10;
  pdf.text('PizzaWala Team • pizzawala-admin.vercel.app', margin, footerY);

  const buffer = pdf.output('arraybuffer') as ArrayBuffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Could not generate PDF.');
  }
  return arrayBufferToBase64(buffer);
}

export function buildWhatsAppShareUrl(message: string, phone?: string) {
  const text = encodeURIComponent(message);
  const digits = phone?.replace(/\D/g, '') || '';
  if (digits) return `https://wa.me/${digits}?text=${text}`;
  return `https://wa.me/?text=${text}`;
}

export function buildScheduleShareMessage(params: {
  startDate: string;
  endDate: string;
  shiftCount: number;
  downloadUrl: string;
}) {
  const period = formatPeriodLabel(params.startDate, params.endDate);
  return [
    '🍕 PizzaWala Schedule',
    period,
    `${params.shiftCount} scheduled shift${params.shiftCount === 1 ? '' : 's'}`,
    '',
    `Download PDF: ${params.downloadUrl}`,
    '',
    'Team app: https://pizzawala-admin.vercel.app/app/schedule',
  ].join('\n');
}

async function getExporterName() {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error('You must be signed in.');
  const fs = getFirestore();
  const snap = await getDoc(doc(fs, 'users', user.uid));
  const data = snap.data();
  return (typeof data?.name === 'string' && data.name.trim()) || user.displayName || user.email || 'Admin';
}

async function uploadPdfViaCloudFunction(storagePath: string, base64: string): Promise<string> {
  const user = nativeAuth().currentUser;
  if (!user) throw new Error('You must be signed in.');
  const idToken = await user.getIdToken(true);

  const response = await fetch(UPLOAD_SCHEDULE_EXPORT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64,
      storagePath,
      contentType: 'application/pdf',
    }),
  });

  let payload: { downloadUrl?: string; error?: string } = {};
  const raw = await response.text();
  if (raw) {
    try {
      payload = JSON.parse(raw) as { downloadUrl?: string; error?: string };
    } catch {
      payload = { error: raw.slice(0, 180) };
    }
  }

  if (!response.ok || !payload.downloadUrl) {
    throw new Error(payload.error || `Server upload failed (${response.status})`);
  }
  return payload.downloadUrl;
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

async function sharePdfOnWhatsApp(params: {
  fileUri: string;
  fileName: string;
  message: string;
  whatsAppPhone?: string;
}) {
  const digits = params.whatsAppPhone?.replace(/\D/g, '') || '';
  await Share.shareSingle({
    title: 'PizzaWala Schedule',
    message: params.message,
    url: params.fileUri,
    type: 'application/pdf',
    filename: params.fileName,
    social: Share.Social.WHATSAPP,
    ...(digits ? { whatsAppNumber: digits } : {}),
  });
}

export async function exportSchedulePdfAndShare(params: {
  shifts: ScheduledShiftRow[];
  startDate: string;
  endDate: string;
  whatsAppPhone?: string;
}) {
  const filtered = filterScheduledInRange(params.shifts, params.startDate, params.endDate);
  const base64 = buildSchedulePdfBase64(filtered, params.startDate, params.endDate);
  if (!base64) throw new Error('Could not generate PDF.');

  const fileName = scheduleExportFileName(params.startDate, params.endDate);
  const storagePath = `schedules/exports/${Date.now()}-${fileName}`;
  const localFile = await writeSchedulePdfToCache(base64, params.startDate, params.endDate);

  let downloadUrl = '';
  let sharedWithPdf = false;
  try {
    downloadUrl = await uploadPdfViaCloudFunction(storagePath, base64);
  } catch (uploadError) {
    const fallbackMessage = [
      '🍕 PizzaWala Schedule',
      formatPeriodLabel(params.startDate, params.endDate),
      `${filtered.length} scheduled shift${filtered.length === 1 ? '' : 's'}`,
      '',
      'PDF attached.',
      '',
      'Team app: https://pizzawala-admin.vercel.app/app/schedule',
    ].join('\n');

    await sharePdfOnWhatsApp({
      fileUri: localFile.fileUri,
      fileName: localFile.fileName,
      message: fallbackMessage,
      whatsAppPhone: params.whatsAppPhone,
    });
    sharedWithPdf = true;
  }

  if (!sharedWithPdf) {
    const exporterName = await getExporterName();
    const fs = getFirestore();

    await addDoc(collection(fs, 'scheduleExports'), {
      startDate: params.startDate,
      endDate: params.endDate,
      shiftCount: filtered.length,
      fileName,
      downloadUrl,
      storagePath,
      createdByUid: auth.currentUser?.uid ?? null,
      createdByName: exporterName,
      createdAt: serverTimestamp(),
      createdAtIso: new Date().toISOString(),
      source: 'mobile',
    });

    const message = buildScheduleShareMessage({
      startDate: params.startDate,
      endDate: params.endDate,
      shiftCount: filtered.length,
      downloadUrl,
    });

    return {
      downloadUrl,
      fileName,
      whatsAppUrl: buildWhatsAppShareUrl(message, params.whatsAppPhone),
      shiftCount: filtered.length,
      message,
      sharedWithPdf: false,
    };
  }

  return {
    downloadUrl: '',
    fileName: localFile.fileName,
    whatsAppUrl: '',
    shiftCount: filtered.length,
    message: '',
    sharedWithPdf: true,
  };
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
}): Promise<{ filePath: string; fileName: string; savedTo: string }> {
  const filtered = filterScheduledInRange(params.shifts, params.startDate, params.endDate);
  const base64 = buildSchedulePdfBase64(filtered, params.startDate, params.endDate);
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
