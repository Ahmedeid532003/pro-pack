import { useLayoutEffect, useRef } from 'react';
import { Printer } from 'lucide-react';
import { balanceSide, formatDate, formatMoney, formatSignedMoney } from '../lib/api';
import { DocExportBar } from './DocExportBar';
import { loadExcel } from '../lib/excel';
import { downloadExcelBuffer } from '../lib/docExport';
import { BrandMark, Button, PrintHeader } from './ui';

export type LedgerRow = {
  date: string;
  type: string;
  ref: string;
  description?: string;
  debit: number;
  credit: number;
  balance: number;
  method?: string | null;
  note?: string | null;
  invoiceTotal?: number | null;
  invoicePaid?: number | null;
  invoiceDue?: number | null;
  productName?: string | null;
  quantity?: number | null;
  weight?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  groupKey?: string | null;
  isGroupFirst?: boolean;
  isGroupLast?: boolean;
  qty?: number | null;
};

export type LedgerPayload = {
  title: string;
  partyName: string;
  partyCode?: string;
  partyKind?: 'customer' | 'supplier';
  balance: number;
  meaning?: string;
  prepaid?: number;
  totals?: { debit: number; credit: number; balance: number };
  statement: LedgerRow[];
  fileName: string;
};

/**
 * المورد: دائن (+) = سداد/مقدم · مدين (−) = شراء
 * العميل عكس المورد: دائن (−) = فاتورة بيع · مدين (+) = تحصيل
 */
function rowSides(row: LedgerRow, kind?: 'customer' | 'supplier') {
  if (kind === 'customer') {
    const daen = row.debit > 0.009 ? row.debit : 0;
    const madeen = row.credit > 0.009 ? row.credit : 0;
    return { daen, madeen, signed: madeen - daen };
  }
  const madeen = row.debit > 0.009 ? row.debit : 0;
  const daen = row.credit > 0.009 ? row.credit : 0;
  return { daen, madeen, signed: daen - madeen };
}

function displayBalance(apiBalance: number, kind?: 'customer' | 'supplier') {
  if (kind === 'customer') return -apiBalance;
  if (kind === 'supplier') return -apiBalance;
  return apiBalance;
}

function isInvoiceType(type: string) {
  return /فاتورة|شراء|بيع/.test(type) && !/مرتجع|سداد|تحصيل|مقدم|خصم/.test(type);
}

function isMoneyMove(type: string) {
  return /سداد|تحصيل|مقدم|مرتجع|خصم/.test(type);
}

function num(v?: number | null) {
  return v != null && Number.isFinite(v) ? v : null;
}

/** يكيّف الكشف ليملأ الحاوية الظاهرة بدون سكرول داخلي قدر الإمكان */
function fitSheetToHost(host: HTMLElement, sheet: HTMLElement) {
  sheet.style.transform = 'none';
  sheet.style.width = '100%';
  const availH = host.clientHeight;
  const availW = host.clientWidth;
  if (availH < 80 || availW < 80) return;
  const naturalH = sheet.scrollHeight;
  const naturalW = sheet.scrollWidth;
  const scale = Math.min(1, availH / Math.max(naturalH, 1), availW / Math.max(naturalW, 1));
  const safe = Math.max(0.45, Math.min(1, scale));
  sheet.style.transformOrigin = 'top center';
  if (safe < 0.995) {
    sheet.style.transform = `scale(${safe})`;
    sheet.style.width = `${100 / safe}%`;
  } else {
    sheet.style.removeProperty('transform');
    sheet.style.width = '100%';
  }
}

export function StatementLedger({ data }: { data: LedgerPayload }) {
  const kind = data.partyKind;
  const customerFlip = kind === 'customer';
  const weightLabel = kind === 'supplier' ? 'الوزن / المتبقي' : 'الوزن';
  const hostRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const rows = data.statement.map((row) => {
    const sides = rowSides(row, kind);
    return { ...row, ...sides };
  });

  let run = 0;
  const withRun = rows.map((row) => {
    run += row.signed;
    return { ...row, signedBalance: Math.round((run + Number.EPSILON) * 100) / 100 };
  });

  const totalLine = withRun.reduce((s, r) => {
    const fromLine = num(r.lineTotal);
    if (fromLine != null) return s + fromLine;
    if (isInvoiceType(r.type) && r.isGroupFirst) return s + (r.invoiceTotal || 0);
    return s;
  }, 0);
  const totalPaid = withRun.reduce((s, r) => {
    if (r.invoicePaid != null && r.invoicePaid > 0.009) return s + r.invoicePaid;
    if (isMoneyMove(r.type) && !isInvoiceType(r.type)) return s + (r.credit || r.debit || 0);
    return s;
  }, 0);
  const totalDue = withRun.reduce((s, r) => s + (r.invoiceDue != null && r.invoiceDue > 0.009 ? r.invoiceDue : 0), 0);
  const totalDaen = withRun.reduce((s, r) => s + r.daen, 0);
  const totalMadeen = withRun.reduce((s, r) => s + r.madeen, 0);
  const signedBalance = displayBalance(data.balance, kind);
  const side = customerFlip
    ? ((signedBalance || 0) < -0.009 ? 'دائن' : (signedBalance || 0) > 0.009 ? 'مدين' : 'صفر')
    : balanceSide(signedBalance);
  const prepaid = data.prepaid ?? Math.max(0, -data.balance);
  const dense = withRun.length > 18;

  useLayoutEffect(() => {
    const host = hostRef.current;
    const sheet = sheetRef.current;
    if (!host || !sheet) return;

    const runFit = () => {
      if (document.body.classList.contains('is-printing') || document.body.classList.contains('printing-statement')) {
        return;
      }
      fitSheetToHost(host, sheet);
    };

    runFit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => runFit()) : null;
    ro?.observe(host);
    window.addEventListener('resize', runFit);
    const t = window.setTimeout(runFit, 60);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', runFit);
      window.clearTimeout(t);
    };
  }, [withRun.length, data.partyName, data.balance]);

  return (
    <div ref={hostRef} className="statement-fit-host flex h-full min-h-0 flex-col overflow-hidden">
      <div ref={sheetRef} className="statement-sheet statement-sheet--light flex w-full flex-col gap-1.5">
        {/* يظهر في الشاشة والطباعة: لوجو + اسم الطرف */}
        <div className="statement-print-header shrink-0">
          <PrintHeader
            title={data.title}
            subtitle={`${data.partyName}${data.partyCode ? ` · ${data.partyCode}` : ''}`}
          />
        </div>

        <div className="statement-print-summary shrink-0 rounded-xl border border-sky-200 bg-gradient-to-l from-sky-50 via-white to-emerald-50 px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <BrandMark size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold text-slate-800">
                  {customerFlip ? 'عميل' : 'مورد'}: {data.partyName}
                </div>
                {data.partyCode && <div className="text-[10px] font-bold text-slate-500" dir="ltr">{data.partyCode}</div>}
              </div>
            </div>
            <div className="text-left">
              <div className={`text-lg font-black money-num ${signedBalance < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                {formatSignedMoney(signedBalance)}
              </div>
              <div className="text-[10px] font-bold text-slate-600">
                الرصيد · {side === 'صفر' ? 'متعادل' : side}
                {data.meaning ? ` · ${data.meaning}` : ''}
              </div>
            </div>
          </div>
          <div className="statement-summary-stats mt-1.5 grid grid-cols-4 gap-1.5">
            <div className="statement-stat-total rounded-md border border-slate-200 bg-white/90 px-2 py-1">
              <div className="text-[9px] font-bold text-slate-500">الإجمالي</div>
              <div className="text-xs font-black money-num text-slate-900">{formatMoney(totalLine || totalDaen)}</div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-1">
              <div className="text-[9px] font-bold text-emerald-700">مدفوع</div>
              <div className="text-xs font-black money-num text-emerald-900">{formatMoney(totalPaid)}</div>
            </div>
            <div className="statement-stat-due rounded-md border border-rose-200 bg-rose-50/80 px-2 py-1">
              <div className="text-[9px] font-bold text-rose-700">متبقي</div>
              <div className="text-xs font-black money-num text-rose-900">{formatMoney(totalDue)}</div>
            </div>
            <div className="rounded-md border border-sky-200 bg-sky-50/80 px-2 py-1">
              <div className="text-[9px] font-bold text-sky-700">مقدم</div>
              <div className="text-xs font-black money-num text-sky-900">{formatMoney(prepaid)}</div>
            </div>
          </div>
        </div>

        <div className="mb-0.5 flex flex-wrap justify-end gap-2 no-print shrink-0">
          <DocExportBar
            className="mb-0"
            onExcel={async () => {
              const ExcelJS = await loadExcel();
              const workbook = new ExcelJS.Workbook();
              const sheet = workbook.addWorksheet('كشف حساب');
              sheet.views = [{ rightToLeft: true }];
              sheet.addRow(['Pro Pack', 'طباعة مواد التعبئة والتغليف']);
              sheet.addRow([data.title, data.partyName]);
              sheet.addRow(['الرصيد', signedBalance, side]);
              sheet.addRow(['الإجمالي', totalLine || totalDaen, 'مدفوع', totalPaid, 'متبقي', totalDue]);
              sheet.addRow([]);
              sheet.addRow([
                'التاريخ', 'الصنف', 'البيان', weightLabel, 'العدد', 'سعر الكيلو',
                'إجمالي السعر', 'المدفوع', 'المتبقي', 'طريقة الدفع', 'الرصيد',
              ]);
              withRun.forEach((row) => {
                const paid = row.invoicePaid != null && row.invoicePaid > 0.009
                  ? row.invoicePaid
                  : isMoneyMove(row.type) ? (row.credit || row.debit || '') : '';
                sheet.addRow([
                  formatDate(row.date),
                  row.productName || '',
                  row.description || row.type,
                  num(row.weight) ?? '',
                  num(row.quantity) ?? '',
                  num(row.unitPrice) ?? '',
                  num(row.lineTotal) ?? (row.isGroupFirst ? row.invoiceTotal ?? '' : ''),
                  paid,
                  row.invoiceDue != null && row.invoiceDue > 0.009 ? row.invoiceDue : '',
                  row.method || '',
                  row.signedBalance,
                ]);
              });
              sheet.addRow([]);
              sheet.addRow(['الإجمالي كام', '', '', '', '', '', totalLine || totalDaen, totalPaid, totalDue, '', signedBalance]);
              const buffer = await workbook.xlsx.writeBuffer();
              await downloadExcelBuffer(buffer as ArrayBuffer, data.fileName);
            }}
          />
          <Button
            variant="secondary"
            onClick={() => {
              window.dispatchEvent(new Event('beforeprint'));
              window.setTimeout(() => window.print(), 80);
            }}
          >
            <Printer size={14} /> طباعة
          </Button>
        </div>

        <div className="statement-table-wrap overflow-visible rounded-lg border border-sky-200 bg-white">
          <table className={`statement-table w-full border-collapse table-fixed ${dense ? 'text-[10px]' : 'text-[11px]'}`}>
            <colgroup>
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '8%' }} />
              <col className="col-lena" style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col className="col-alena" style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} />
            </colgroup>
            <thead>
              <tr className="bg-sky-100 text-slate-800">
                <th className="border border-sky-200 px-1 py-1 text-right font-black">التاريخ</th>
                <th className="border border-sky-200 px-1 py-1 text-right font-black">الصنف</th>
                <th className="border border-sky-200 px-1 py-1 text-right font-black">البيان</th>
                <th className="border border-sky-200 px-1 py-1 text-right font-black">{weightLabel}</th>
                <th className="border border-sky-200 px-1 py-1 text-right font-black">العدد</th>
                <th className="border border-sky-200 px-1 py-1 text-right font-black">سعر الكيلو</th>
                <th className="col-lena border border-amber-200 bg-amber-100 px-1 py-1 text-right font-black text-amber-950">إجمالي</th>
                <th className="col-paid border border-emerald-200 bg-emerald-100 px-1 py-1 text-right font-black text-emerald-900">مدفوع</th>
                <th className="col-alena border border-rose-200 bg-rose-100 px-1 py-1 text-right font-black text-rose-900">متبقي</th>
                <th className="border border-sky-200 bg-sky-50 px-1 py-1 text-right font-black text-sky-900">دفع</th>
                <th className="col-bal border border-slate-200 bg-slate-100 px-1 py-1 text-right font-black text-slate-800">رصيد</th>
              </tr>
            </thead>
            <tbody>
              {withRun.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-muted">لا توجد حركات في الكشف</td>
                </tr>
              ) : withRun.map((row, index) => {
                const paidCell = row.invoicePaid != null && row.invoicePaid > 0.009
                  ? formatMoney(row.invoicePaid)
                  : isMoneyMove(row.type)
                    ? formatMoney(row.credit || row.debit)
                    : '—';
                const dueCell = row.invoiceDue != null && row.invoiceDue > 0.009
                  ? formatMoney(row.invoiceDue)
                  : '—';
                const lineCell = num(row.lineTotal) != null
                  ? formatMoney(row.lineTotal!)
                  : row.isGroupFirst && row.invoiceTotal != null
                    ? formatMoney(row.invoiceTotal)
                    : isMoneyMove(row.type)
                      ? formatMoney(row.credit || row.debit)
                      : '—';
                return (
                  <tr
                    key={index}
                    className={[
                      index % 2 ? 'bg-slate-50/80' : 'bg-white',
                      row.isGroupLast ? 'border-b border-b-sky-200' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <td className="cell-num border border-slate-200 px-1 py-0.5 whitespace-nowrap font-bold text-slate-800">
                      {row.isGroupFirst !== false || !row.groupKey ? formatDate(row.date) : ''}
                    </td>
                    <td className="border border-slate-200 px-1 py-0.5 font-extrabold text-slate-900 leading-tight">
                      {row.productName || '—'}
                    </td>
                    <td className="border border-slate-200 px-1 py-0.5 leading-tight">
                      <div className="font-extrabold text-slate-900">{row.description || row.type}</div>
                      {!dense && row.note && <div className="text-[9px] font-semibold text-slate-500">{row.note}</div>}
                      <div className="text-[8px] font-bold text-slate-400">{row.ref}</div>
                    </td>
                    <td className="cell-num border border-slate-200 px-1 py-0.5 text-left font-bold" dir="ltr">
                      {num(row.weight) != null ? row.weight : '—'}
                    </td>
                    <td className="cell-num border border-slate-200 px-1 py-0.5 text-left font-bold" dir="ltr">
                      {num(row.quantity) != null ? row.quantity : '—'}
                    </td>
                    <td className="cell-num border border-slate-200 px-1 py-0.5 text-left font-bold" dir="ltr">
                      {num(row.unitPrice) != null ? formatMoney(row.unitPrice!) : '—'}
                    </td>
                    <td className="col-lena cell-num border border-amber-100 bg-amber-50/70 px-1 py-0.5 text-left font-black text-slate-900" dir="ltr">
                      {lineCell}
                    </td>
                    <td className="col-paid cell-num border border-emerald-100 bg-emerald-50/70 px-1 py-0.5 text-left font-black text-emerald-900" dir="ltr">
                      {paidCell}
                    </td>
                    <td className="col-alena cell-num border border-rose-100 bg-rose-50/70 px-1 py-0.5 text-left font-black text-rose-900" dir="ltr">
                      {dueCell}
                    </td>
                    <td className="border border-sky-100 bg-sky-50/50 px-1 py-0.5 font-extrabold text-sky-900 leading-tight">
                      {row.method || '—'}
                    </td>
                    <td className={`cell-num border border-slate-200 px-1 py-0.5 text-left font-black ${row.signedBalance < 0 ? 'text-rose-700' : 'text-emerald-800'}`} dir="ltr">
                      {row.isGroupLast !== false || !row.groupKey || Math.abs(row.signed) > 0.009
                        ? formatSignedMoney(row.signedBalance)
                        : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-sky-50 text-slate-900">
                <td colSpan={6} className="border border-sky-200 px-1.5 py-1 text-right font-black">
                  <span className="statement-foot-full">الإجمالي · مدفوع · متبقي · الرصيد</span>
                  <span className="statement-foot-print hidden">مدفوع · الرصيد</span>
                </td>
                <td className="col-lena cell-num border border-amber-200 bg-amber-100 px-1 py-1 text-left font-black text-slate-950" dir="ltr">
                  {formatMoney(totalLine || totalDaen)}
                </td>
                <td className="col-paid cell-num border border-emerald-200 bg-emerald-100 px-1 py-1 text-left font-black text-emerald-950" dir="ltr">
                  {formatMoney(totalPaid)}
                </td>
                <td className="col-alena cell-num border border-rose-200 bg-rose-100 px-1 py-1 text-left font-black text-rose-950" dir="ltr">
                  {formatMoney(totalDue)}
                </td>
                <td className="border border-sky-200 px-1 py-1 text-center text-slate-400">—</td>
                <td className={`cell-num border border-slate-200 bg-white px-1 py-1 text-left font-black ${signedBalance < 0 ? 'text-rose-700' : 'text-emerald-800'}`} dir="ltr">
                  {formatSignedMoney(signedBalance)}
                </td>
              </tr>
              <tr className="bg-white text-slate-700">
                <td colSpan={11} className="border border-sky-200 px-1.5 py-1 text-[10px] font-bold">
                  {customerFlip ? `إجمالي دائن (−): ${formatMoney(totalDaen)} · إجمالي مدين (+): ${formatMoney(totalMadeen)}`
                    : `إجمالي مدين (−): ${formatMoney(totalMadeen)} · إجمالي دائن (+): ${formatMoney(totalDaen)}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
