import { BadRequestException } from '@nestjs/common';

export type HrSettings = {
  daysPerMonth: number;
  hoursPerDay: number;
  weekendDays: number[];
  lateGraceMinutes: number;
  /** @deprecated — التأخير يُحسب بسعر الساعة من المرتب */
  latePenaltyPerMinute: number;
  permissionDeductPerHour: number;
  workStartHour: number;
  workStartMinute: number;
  /** الإضافي: ساعة بساعتين = 2 */
  overtimeMultiplier: number;
  /** الغياب: يوم بيوم = 1 · يوم بيومين = 2 */
  absenceMultiplier: number;
  /** الإجازة غير المدفوعة: خصم يوم بيوم */
  unpaidLeaveDeduct: boolean;
  /** التأخير: تجميع دقائق الشهر وخصم بسعر الساعة */
  lateByHourlyRate: boolean;
};

export const DEFAULT_HR_SETTINGS: HrSettings = {
  daysPerMonth: 30,
  hoursPerDay: 10,
  weekendDays: [5, 6],
  lateGraceMinutes: 15,
  latePenaltyPerMinute: 0,
  permissionDeductPerHour: 0,
  workStartHour: 9,
  workStartMinute: 0,
  overtimeMultiplier: 2,
  absenceMultiplier: 2,
  unpaidLeaveDeduct: true,
  lateByHourlyRate: true,
};

export const HR_SETTINGS_KEY = 'hr.settings';
export const SALARY_EXPENSE_CATEGORY = 'رواتب';

export function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Daily hours for one employee: their own value, else the HR default. */
export function employeeHours(emp: { workHours?: number | null }, settings: HrSettings) {
  return emp.workHours && emp.workHours > 0 ? emp.workHours : settings.hoursPerDay;
}

/** Hourly pay from the monthly salary, and the overtime price per hour. */
export function overtimeRates(emp: { salary: number; workHours?: number | null }, settings: HrSettings) {
  const daily = (emp.salary || 0) / settings.daysPerMonth;
  const hourlyRate = roundMoney(daily / Math.max(1, employeeHours(emp, settings)));
  return { hourlyRate, overtimeRate: roundMoney(hourlyRate * settings.overtimeMultiplier) };
}

export function parseHrSettings(raw: string | null | undefined): HrSettings {
  if (!raw) return { ...DEFAULT_HR_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<HrSettings>;
    const absenceMultiplier = parsed.absenceMultiplier == null
      ? DEFAULT_HR_SETTINGS.absenceMultiplier
      : Number(parsed.absenceMultiplier);
    return {
      daysPerMonth: Math.max(1, Number(parsed.daysPerMonth) || DEFAULT_HR_SETTINGS.daysPerMonth),
      hoursPerDay: Math.max(1, Number(parsed.hoursPerDay) || DEFAULT_HR_SETTINGS.hoursPerDay),
      weekendDays: Array.isArray(parsed.weekendDays)
        ? parsed.weekendDays.map(Number).filter((d) => d >= 0 && d <= 6)
        : DEFAULT_HR_SETTINGS.weekendDays,
      lateGraceMinutes: Math.max(0, Number(parsed.lateGraceMinutes) || 0),
      latePenaltyPerMinute: Math.max(0, Number(parsed.latePenaltyPerMinute) || 0),
      permissionDeductPerHour: Math.max(0, Number(parsed.permissionDeductPerHour) || 0),
      workStartHour: Math.min(23, Math.max(0, Number(parsed.workStartHour) ?? DEFAULT_HR_SETTINGS.workStartHour)),
      workStartMinute: Math.min(59, Math.max(0, Number(parsed.workStartMinute) ?? DEFAULT_HR_SETTINGS.workStartMinute)),
      overtimeMultiplier: Math.max(1, Number(parsed.overtimeMultiplier) || DEFAULT_HR_SETTINGS.overtimeMultiplier),
      absenceMultiplier: absenceMultiplier === 2 ? 2 : 1,
      unpaidLeaveDeduct: parsed.unpaidLeaveDeduct !== false,
      lateByHourlyRate: parsed.lateByHourlyRate !== false,
    };
  } catch {
    return { ...DEFAULT_HR_SETTINGS };
  }
}

const CAIRO_TZ = 'Africa/Cairo';

/** YYYY-MM-DD in Africa/Cairo */
export function cairoYmd(input?: Date | string | null) {
  if (input == null || input === '') return cairoYmd(new Date());
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('تاريخ غير صالح');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Alias: يوم تقويمي بتوقيت القاهرة */
export function egyptDayKey(input?: Date | string | null) {
  return cairoYmd(input);
}

/** بداية اليوم بتوقيت القاهرة (UTC representation) */
export function egyptDayStart(input?: Date | string | null) {
  const ymd = egyptDayKey(input);
  return new Date(`${ymd}T00:00:00.000+02:00`);
}

/** نهاية اليوم بتوقيت القاهرة */
export function egyptDayEnd(input?: Date | string | null) {
  const ymd = egyptDayKey(input);
  return new Date(`${ymd}T23:59:59.999+02:00`);
}

/** دقائق منذ منتصف الليل بتوقيت القاهرة */
export function egyptMinutesOf(input: Date | string) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('وقت غير صالح');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return h * 60 + m;
}

/** تحويل "HH:mm" إلى دقائق */
export function parseTimeToMinutes(value: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
  if (!m) throw new BadRequestException('صيغة الوقت لازم تكون ساعة:دقيقة مثل 09:30');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new BadRequestException('وقت خارج النطاق');
  return h * 60 + min;
}

/** Store date-only as UTC noon so day never shifts across zones */
export function dateOnly(input: Date | string) {
  const ymd = cairoYmd(input);
  return new Date(`${ymd}T12:00:00.000Z`);
}

export function parseRange(from?: string, to?: string) {
  if (!from || !to) throw new BadRequestException('حدد تاريخ البداية والنهاية');
  const fromDate = dateOnly(from);
  const toDate = dateOnly(to);
  if (fromDate.getTime() > toDate.getTime()) throw new BadRequestException('تاريخ البداية بعد النهاية');
  return { fromDate, toDate, fromYmd: cairoYmd(fromDate), toYmd: cairoYmd(toDate) };
}

export function eachYmd(fromYmd: string, toYmd: string) {
  const out: string[] = [];
  let cur = dateOnly(fromYmd);
  const end = dateOnly(toYmd).getTime();
  while (cur.getTime() <= end) {
    out.push(cairoYmd(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

/** JS weekday 0=Sun … 6=Sat for a YYYY-MM-DD (Cairo calendar day) */
export function weekdayOfYmd(ymd: string) {
  return dateOnly(ymd).getUTCDay();
}

/** يوم الأسبوع 0=أحد … 6=سبت ليوم القاهرة */
export function egyptWeekday(input?: Date | string | null) {
  return weekdayOfYmd(egyptDayKey(input));
}

export function isWeekend(ymd: string, weekendDays: number[]) {
  return weekendDays.includes(weekdayOfYmd(ymd));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextSeq(tx: any, key: string, prefix: string) {
  const seq = await tx.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(seq.value).padStart(6, '0')}`;
}
