import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Boxes, ClipboardCheck, Coins, Download, Factory, FileSpreadsheet, Package, PackageX, Percent, Printer, ShoppingCart,
  TrendingDown, TrendingUp, Truck, Users, Wallet,
} from 'lucide-react';
import { loadExcel } from '../lib/excel';
import { api, formatDate, formatMoney, getApiBase } from '../lib/api';
import { sizeText } from '../lib/size';
import { DueAmount } from '../components/DueAmount';
import {
  Badge, Button, Card, CardHeader, Empty, Input, Label, PageHeader, PrintHeader, SearchBox, StatCard, StatGrid, StatusBadge, Table, Td, Th,
} from '../components/ui';

type ProfitLine = {
  id: string;
  kind: 'REVENUE' | 'RETURN' | 'COGS' | 'COGS_RETURN' | 'EXPENSE' | 'INCOME' | 'DISCOUNT' | 'TAX';
  date: string;
  reference: string;
  party: string;
  description: string;
  quantity: number | null;
  unitAmount: number | null;
  amount: number;
  side: 'IN' | 'OUT';
};

const PROFIT_KIND: Record<ProfitLine['kind'], { label: string; tone: 'emerald' | 'rose' | 'sky' | 'amber' | 'violet' | 'slate' }> = {
  REVENUE: { label: 'إيراد بيع', tone: 'emerald' },
  TAX: { label: 'ضريبة', tone: 'emerald' },
  RETURN: { label: 'مرتجع بيع', tone: 'rose' },
  DISCOUNT: { label: 'خصم فاتورة', tone: 'amber' },
  COGS: { label: 'تكلفة بضاعة', tone: 'sky' },
  COGS_RETURN: { label: 'استرداد تكلفة', tone: 'sky' },
  EXPENSE: { label: 'مصروف', tone: 'rose' },
  INCOME: { label: 'وارد مالي', tone: 'emerald' },
};

function ProfitView({
  revenue,
  cogs,
  expenses,
  incomes = 0,
  gross,
  net,
  lines,
}: {
  revenue: number;
  cogs: number;
  expenses: number;
  incomes?: number;
  gross: number;
  net: number;
  invoiceDiff?: number;
  lines: ProfitLine[];
}) {
  const [filter, setFilter] = useState<'all' | 'IN' | 'OUT' | 'REVENUE' | 'COGS' | 'EXPENSE' | 'INCOME'>('all');
  const margin = revenue > 0 ? (net / revenue) * 100 : 0;
  const cogsPct = revenue > 0 ? Math.min(100, Math.max(0, (cogs / revenue) * 100)) : 0;
  const expensePct = revenue > 0 ? Math.min(100, Math.max(0, (expenses / revenue) * 100)) : 0;
  const profitPct = Math.max(0, 100 - cogsPct - expensePct);
  const visible = lines.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'IN') return row.side === 'IN';
    if (filter === 'OUT') return row.side === 'OUT';
    if (filter === 'REVENUE') return row.kind === 'REVENUE' || row.kind === 'RETURN' || row.kind === 'TAX' || row.kind === 'DISCOUNT';
    if (filter === 'COGS') return row.kind === 'COGS' || row.kind === 'COGS_RETURN';
    if (filter === 'INCOME') return row.kind === 'INCOME';
    return row.kind === 'EXPENSE';
  });

  const positiveNet = Math.max(0, net);

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border-2 px-6 py-6 text-white shadow-xl ${net >= 0 ? 'border-emerald-800 bg-gradient-to-br from-emerald-600 via-emerald-700 to-emerald-950' : 'border-rose-800 bg-gradient-to-br from-rose-600 via-rose-700 to-rose-950'}`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm font-bold tracking-wide text-white/80">صافي الأرباح</div>
            <div className="mt-1 text-5xl font-black tabular-nums tracking-tight" dir="ltr">
              {net >= 0 ? '+' : ''}{formatMoney(net)}
            </div>
            <div className="mt-3 max-w-xl text-sm font-semibold leading-6 text-white/90">
              إيراد البيع {formatMoney(revenue)} − تكلفة {formatMoney(cogs)} − مصروفات {formatMoney(expenses)}
              {incomes > 0.009 ? ` + واردات ${formatMoney(incomes)}` : ''}
            </div>
            <div className="mt-1 text-xs text-white/70">
              مجمل الربح {formatMoney(gross)} · هامش {(Number.isFinite(margin) ? margin : 0).toFixed(1)}%
              {net < 0 ? ' · الخسارة تظهر بالسالب محاسبيًا' : ` · الربح الموجب للتوزيع ${formatMoney(positiveNet)}`}
            </div>
          </div>
          <div className="rounded-2xl bg-white/15 px-5 py-4 text-left backdrop-blur-sm">
            <div className="text-[11px] font-bold text-white/70">عند كل بيع</div>
            <div className="mt-1 text-sm font-extrabold">يُضاف مكسب = سعر البيع − تكلفة الصنف</div>
            <div className="mt-1 text-xs font-semibold text-white/80">ثم يُخصم مجموع المصروفات من مجمل الأرباح</div>
          </div>
        </div>
      </div>

      <StatGrid>
        <StatCard label="صافي إيراد البيع" value={formatMoney(revenue)} hint="بعد المرتجعات والخصم والضريبة" icon={ShoppingCart} tone="emerald" />
        <StatCard label="تكلفة البضاعة المباعة" value={formatMoney(cogs)} hint="من تكلفة الصنف وقت البيع" icon={Coins} tone="sky" />
        <StatCard label="المصروفات" value={formatMoney(expenses)} hint="مصروفات الفترة" icon={Wallet} tone="rose" />
        <StatCard label="الواردات" value={formatMoney(incomes)} hint="فلوس داخلة غير المبيعات" icon={ArrowDownLeft} tone="emerald" />
        <StatCard label="صافي الربح" value={<span className={net >= 0 ? 'text-emerald-700' : 'text-rose-600'}>{formatMoney(net)}</span>} hint={`مجمل ${formatMoney(gross)}`} icon={TrendingUp} tone={net >= 0 ? 'emerald' : 'rose'} />
      </StatGrid>
      <Card>
        <CardHeader title="تركيب الربح" subtitle={`هامش صافي ${(Number.isFinite(margin) ? margin : 0).toFixed(1)}% من الإيراد`} icon={Percent} />
        <div className="flex h-5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-gradient-to-l from-sky-400 to-sky-600 transition-all" style={{ width: `${cogsPct}%` }} />
          <div className="h-full bg-gradient-to-l from-rose-400 to-rose-600 transition-all" style={{ width: `${expensePct}%` }} />
          <div className="h-full bg-gradient-to-l from-emerald-400 to-emerald-600 transition-all" style={{ width: `${profitPct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-3 text-sm">
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-sky-500" /> تكلفة البضاعة <b className="tabular-nums">{cogsPct.toFixed(1)}%</b></span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-rose-500" /> مصروفات <b className="tabular-nums">{expensePct.toFixed(1)}%</b></span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-emerald-500" /> صافي الربح <b className="tabular-nums">{profitPct.toFixed(1)}%</b></span>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="تفاصيل احتساب الربح"
          subtitle={`${visible.length} حركة من أصل ${lines.length}`}
          icon={FileSpreadsheet}
          actions={(
            <div className="flex flex-wrap gap-1">
              {([
                ['all', 'الكل'],
                ['IN', 'دخل'],
                ['OUT', 'خرج'],
                ['REVENUE', 'إيراد ومرتجع'],
                ['COGS', 'تكلفة'],
                ['EXPENSE', 'مصروف'],
                ['INCOME', 'وارد'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold ${filter === key ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        />
        {visible.length === 0 ? <Empty text="مفيش حركات في الفترة دي" /> : (
          <Table>
            <thead>
              <tr>
                <Th>التاريخ</Th>
                <Th>النوع</Th>
                <Th>المرجع</Th>
                <Th>التفاصيل</Th>
                <Th>الطرف</Th>
                <Th>الكمية</Th>
                <Th>سعر/تكلفة</Th>
                <Th>المبلغ</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const meta = PROFIT_KIND[row.kind];
                const signed = row.side === 'IN' ? row.amount : -row.amount;
                return (
                  <tr key={row.id} className={row.side === 'IN' ? 'row-debit' : 'row-credit'}>
                    <Td className="whitespace-nowrap text-slate-500">{formatDate(row.date)}</Td>
                    <Td><Badge tone={meta.tone}>{meta.label}</Badge></Td>
                    <Td className="font-mono text-xs font-bold">{row.reference}</Td>
                    <Td className="max-w-xs truncate text-slate-700">{row.description}</Td>
                    <Td className="text-slate-600">{row.party}</Td>
                    <Td className="tabular-nums">{row.quantity == null ? '—' : row.quantity}</Td>
                    <Td className="tabular-nums">{row.unitAmount == null ? '—' : formatMoney(row.unitAmount)}</Td>
                    <Td className={`whitespace-nowrap font-extrabold ${signed >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {signed >= 0 ? '+' : ''}{formatMoney(signed)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

type InventoryRow = {
  quantity: number;
  product: { sku: string; name: string; unit: string; costPrice: number; salePrice: number };
  warehouse: { name: string };
};

type SalesReport = {
  invoices: { number: string; total: number; discount: number; paidAmount: number; status: string; invoiceDate: string; customer: { name: string }; warehouse: { name: string } }[];
  total: number;
  paid: number;
  count: number;
};

type PurchasesReport = {
  invoices: { number: string; total: number; paidAmount: number; status: string; invoiceDate: string; supplier: { name: string }; warehouse: { name: string } }[];
  total: number;
  paid: number;
  count: number;
};

type Profit = {
  salesTotal: number;
  purchasesTotal: number;
  grossProfit: number;
  salesCount: number;
  purchasesCount: number;
  revenue?: number;
  cogs?: number;
  expenses?: number;
  incomes?: number;
  operatingProfit?: number;
  netProfit?: number;
  lines?: ProfitLine[];
};

type ProductRow = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  costPrice: number;
  salePrice: number;
  stockQty: number;
  quantity: number;
  amount: number;
};

type LossRow = ProductRow & { revenue: number; cost: number; loss: number };

type UnderpricedRow = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  stockQty: number;
  costPrice: number;
  salePrice: number;
  gap: number;
  potentialLoss: number;
};

type UnsoldRow = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  stockQty: number;
  stockValue: number;
  purchasedQty: number;
  costPrice: number;
  salePrice: number;
};

type ProductInsights = {
  topSold: ProductRow[];
  topPurchased: ProductRow[];
  losses: LossRow[];
  lossTotal: number;
  underpriced: UnderpricedRow[];
  potentialLossTotal: number;
  unsold: UnsoldRow[];
  unsoldValue: number;
};

type ReportTab = 'inventory' | 'count' | 'sales' | 'purchases' | 'profit' | 'cash' | 'products' | 'customers' | 'suppliers' | 'finance' | 'hr' | 'production';
type AppliedFilter = { all: boolean; ids: string[]; from: string; to: string };

type CountSheet = {
  rows: {
    warehouse: { id: string; code: string; name: string };
    product: { id: string; sku: string; name: string; unit: string; width?: number | null; thickness?: number | null; weight?: number | null };
    quantity: number;
    lastCountAt: string | null;
  }[];
  lastCountAt: string | null;
  totalQty: number;
};

type PartyReport = {
  totalDue: number;
  totalPrepaid: number;
  dueCount: number;
  prepaidCount: number;
  count: number;
  customers?: { id: string; code: string; name: string; phone?: string | null; balance: number; _count: { salesInvoices: number; receipts: number } }[];
  suppliers?: { id: string; code: string; name: string; phone?: string | null; balance: number; _count: { purchaseInvoices: number; payments: number } }[];
};

type FinanceReport = {
  expenses: { id: string; amount: number; expenseDate: string; notes?: string | null; category: { name: string }; account: { name: string } }[];
  incomes: { id: string; amount: number; incomeDate: string; notes?: string | null; category: { name: string }; account: { name: string } }[];
  checks: { id: string; checkNumber: string; bankName: string; amount: number; dueDate: string; status: string; direction: string; customer?: { name: string } | null; supplier?: { name: string } | null }[];
  transfers: { id: string; number: string; amount: number; note?: string | null; createdAt: string; fromAccount: { name: string }; toAccount: { name: string }; createdBy?: { fullName: string } | null }[];
  expenseTotal: number;
  incomeTotal: number;
  net: number;
  transferTotal: number;
  pendingChecks: number;
  byExpenseCategory: { label: string; value: number }[];
  byIncomeCategory: { label: string; value: number }[];
};

type HrReport = {
  employees: { id: string; code: string; name: string; salary: number; commissionPercent: number; phone?: string | null; _count: { attendance: number; leaves: number; movements: number } }[];
  attendance: { id: string; workDate: string; status: string; lateMinutes: number; overtimeMinutes: number; overtimeApproved: boolean; employee: { code: string; name: string } }[];
  leaves: { id: string; fromDate: string; toDate: string; kind: string; status: string; employee: { code: string; name: string } }[];
  movements: { id: string; kind: string; amount: number; movementDate: string; notes?: string | null; employee: { code: string; name: string } }[];
  payroll: { id: string; number: string; fromDate: string; toDate: string; status: string; totalNet: number; lines: { employee: { code: string; name: string }; net?: number }[] }[];
  employeeCount: number;
  salaryTotal: number;
  overtimeMinutes: number;
  movementTotal: number;
  leaveCount: number;
  attendanceCount: number;
};

type ProductionReport = {
  orders: { id: string; number: string; status: string; quantity: number; totalCost: number; createdAt: string; product: { sku: string; name: string }; rawWarehouse: { name: string }; finishedWarehouse: { name: string } }[];
  jobs: { id: string; number: string; status: string; title?: string | null; totalCost: number; createdAt: string; finishedProduct?: { sku: string; name: string } | null; rawWarehouse: { name: string }; finishedWarehouse: { name: string }; stages: { kind: string; status?: string }[] }[];
  orderCount: number;
  jobCount: number;
  orderCost: number;
  jobCost: number;
  totalCost: number;
};

const NO_DATES: ReportTab[] = ['inventory', 'count', 'customers', 'suppliers'];

const TAB_LABEL: Record<ReportTab, string> = {
  inventory: 'المخزون',
  count: 'بيان جرد',
  sales: 'المبيعات',
  purchases: 'المشتريات',
  profit: 'الأرباح',
  products: 'المنتجات',
  cash: 'الخزنة',
  customers: 'العملاء',
  suppliers: 'الموردين',
  finance: 'المالية',
  hr: 'الموارد البشرية',
  production: 'التصنيع',
};

export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('inventory');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [countSheet, setCountSheet] = useState<CountSheet | null>(null);
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [purchases, setPurchases] = useState<PurchasesReport | null>(null);
  const [profit, setProfit] = useState<Profit | null>(null);
  const [cash, setCash] = useState<{ totalIn: number; totalOut: number; net: number; transactions: { direction: string; amount: number; description: string; createdAt: string; account: { name: string } }[] } | null>(null);
  const [customersReport, setCustomersReport] = useState<PartyReport | null>(null);
  const [suppliersReport, setSuppliersReport] = useState<PartyReport | null>(null);
  const [financeReport, setFinanceReport] = useState<FinanceReport | null>(null);
  const [hrReport, setHrReport] = useState<HrReport | null>(null);
  const [productionReport, setProductionReport] = useState<ProductionReport | null>(null);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [allWarehouses, setAllWarehouses] = useState(false);
  const [applied, setApplied] = useState<AppliedFilter | null>(null);
  const [search, setSearch] = useState('');
  const [salesCols, setSalesCols] = useState({ customer: true, date: true, total: true, status: true });
  const [purchaseCols, setPurchaseCols] = useState({ supplier: true, date: true, total: true, status: true });
  const [products, setProducts] = useState<ProductInsights | null>(null);
  const ready = allWarehouses || picked.length > 0;

  const filteredInventory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter((r) =>
      [r.product.sku, r.product.name, r.warehouse.name].some((x) => x.toLowerCase().includes(q)),
    );
  }, [inventory, search]);

  const filteredCount = useMemo(() => {
    const rows = countSheet?.rows || [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.product.sku, r.product.name, r.warehouse.name, sizeText(r.product.width, r.product.thickness)]
        .some((x) => x.toLowerCase().includes(q)),
    );
  }, [countSheet, search]);

  const productQuery = search.trim().toLowerCase();
  const matchProduct = (row: { sku: string; name: string }) =>
    !productQuery || [row.sku, row.name].some((value) => value.toLowerCase().includes(productQuery));
  const visibleSold = products?.topSold.filter(matchProduct) || [];
  const visiblePurchased = products?.topPurchased.filter(matchProduct) || [];
  const visibleLosses = products?.losses.filter(matchProduct) || [];
  const visibleUnderpriced = products?.underpriced.filter(matchProduct) || [];
  const visibleUnsold = products?.unsold.filter(matchProduct) || [];

  function queryFor(next: AppliedFilter, withDates: boolean) {
    const params = new URLSearchParams();
    if (withDates && next.from) params.set('from', next.from);
    if (withDates && next.to) params.set('to', next.to);
    if (!next.all && next.ids.length) params.set('warehouseIds', next.ids.join(','));
    const text = params.toString();
    return text ? `?${text}` : '';
  }

  async function load(next = applied, nextTab = tab) {
    if (!next) return;
    const suffix = queryFor(next, !NO_DATES.includes(nextTab));
    if (nextTab === 'inventory') {
      setInventory(await api<InventoryRow[]>(`/reports/inventory${suffix}`));
    } else if (nextTab === 'count') {
      setCountSheet(await api<CountSheet>(`/reports/count-sheet${suffix}`));
    } else if (nextTab === 'sales') {
      setSales(await api<SalesReport>(`/reports/sales${suffix}`));
    } else if (nextTab === 'purchases') {
      setPurchases(await api<PurchasesReport>(`/reports/purchases${suffix}`));
    } else if (nextTab === 'profit') {
      setProfit(await api<Profit>(`/reports/profit${suffix}`));
    } else if (nextTab === 'cash') {
      setCash(await api(`/reports/cash${suffix}`));
    } else if (nextTab === 'customers') {
      setCustomersReport(await api<PartyReport>('/reports/customers'));
    } else if (nextTab === 'suppliers') {
      setSuppliersReport(await api<PartyReport>('/reports/suppliers'));
    } else if (nextTab === 'finance') {
      setFinanceReport(await api<FinanceReport>(`/reports/finance${suffix}`));
    } else if (nextTab === 'hr') {
      setHrReport(await api<HrReport>(`/reports/hr${suffix}`));
    } else if (nextTab === 'production') {
      setProductionReport(await api<ProductionReport>(`/reports/production${suffix}`));
    } else {
      setProducts(await api<ProductInsights>(`/reports/products${suffix}`));
    }
  }

  useEffect(() => {
    const raw = localStorage.getItem('m5azen_report_range');
    if (raw) {
      try {
        const range = JSON.parse(raw) as { from?: string; to?: string };
        if (range.from) setFrom(range.from);
        if (range.to) setTo(range.to);
      } catch { /* التاريخ المحفوظ مش شرط يفضل صالح */ }
    }
    api<{ id: string; name: string }[]>('/warehouses').then(setWarehouses).catch(() => setWarehouses([]));
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'count') {
      const ids = (params.get('warehouses') || '').split(',').filter(Boolean);
      setTab('count');
      setAllWarehouses(!ids.length);
      setPicked(ids);
      setApplied({ all: !ids.length, ids, from: '', to: '' });
    }
  }, []);

  useEffect(() => { if (applied) load(applied, tab).catch(() => undefined); }, [tab, applied]);

  function applyPreset(kind: 'today' | 'week' | 'month' | 'year') {
    const end = new Date();
    const start = new Date();
    if (kind === 'week') start.setDate(end.getDate() - 6);
    if (kind === 'month') start.setDate(1);
    if (kind === 'year') start.setMonth(0, 1);
    const iso = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const range = { from: iso(start), to: iso(end) };
    setFrom(range.from);
    setTo(range.to);
    localStorage.setItem('m5azen_report_range', JSON.stringify(range));
    if (!ready) return;
    setApplied({ all: allWarehouses, ids: allWarehouses ? [] : picked, from: range.from, to: range.to });
  }

  function showReport() {
    if (!ready) return;
    setApplied({ all: allWarehouses, ids: allWarehouses ? [] : picked, from, to });
  }

  async function exportExcel() {
    if (tab === 'inventory') {
      const token = localStorage.getItem('m5azen_token');
      const q = applied && !applied.all && applied.ids.length ? `?warehouseIds=${applied.ids.join(',')}` : '';
      const res = await fetch(`${getApiBase()}/api/reports/inventory/excel${q}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventory.xlsx';
      a.click();
      return;
    }

    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(tab === 'count' ? 'بيان جرد' : 'تقرير');
    if (tab === 'count' && countSheet) {
      ws.views = [{ rightToLeft: true }];
      ws.columns = [
        { header: 'م', key: 'index', width: 6 },
        { header: 'المخزن', key: 'warehouse', width: 18 },
        { header: 'الكود', key: 'sku', width: 14 },
        { header: 'الصنف', key: 'name', width: 30 },
        { header: 'العرض (سم)', key: 'width', width: 11 },
        { header: 'السمك (سم)', key: 'thickness', width: 11 },
        { header: 'الوحدة', key: 'unit', width: 10 },
        { header: 'الكمية بالسيستم', key: 'qty', width: 14 },
        { header: 'آخر جرد', key: 'lastCount', width: 14 },
        { header: 'الكمية الفعلية', key: 'actual', width: 14 },
        { header: 'الفرق', key: 'diff', width: 10 },
      ];
      filteredCount.forEach((r, index) => {
        ws.addRow({
          index: index + 1,
          warehouse: r.warehouse.name,
          sku: r.product.sku,
          name: r.product.name,
          width: r.product.width ?? '',
          thickness: r.product.thickness ?? '',
          unit: r.product.unit,
          qty: r.quantity,
          lastCount: r.lastCountAt ? formatDate(r.lastCountAt) : '',
          actual: '',
          diff: '',
        });
      });
    } else if (tab === 'sales' && sales) {
      ws.columns = [
        { header: 'الرقم', key: 'number', width: 14 },
        { header: 'العميل', key: 'customer', width: 24 },
        { header: 'المخزن', key: 'warehouse', width: 18 },
        { header: 'التاريخ', key: 'date', width: 14 },
        { header: 'الخصم', key: 'discount', width: 14 },
        { header: 'الإجمالي', key: 'total', width: 14 },
        { header: 'المدفوع', key: 'paid', width: 14 },
        { header: 'الحالة', key: 'status', width: 12 },
      ];
      sales.invoices.forEach((i) => {
        ws.addRow({
          number: i.number,
          customer: i.customer.name,
          warehouse: i.warehouse.name,
          date: formatDate(i.invoiceDate),
          discount: i.discount || 0,
          total: i.total,
          paid: i.paidAmount,
          status: i.status,
        });
      });
    } else if (tab === 'purchases' && purchases) {
      ws.columns = [
        { header: 'الرقم', key: 'number', width: 14 },
        { header: 'المورد', key: 'supplier', width: 24 },
        { header: 'المخزن', key: 'warehouse', width: 18 },
        { header: 'التاريخ', key: 'date', width: 14 },
        { header: 'الإجمالي', key: 'total', width: 14 },
        { header: 'المدفوع', key: 'paid', width: 14 },
        { header: 'الحالة', key: 'status', width: 12 },
      ];
      purchases.invoices.forEach((invoice) => {
        ws.addRow({
          number: invoice.number,
          supplier: invoice.supplier.name,
          warehouse: invoice.warehouse.name,
          date: formatDate(invoice.invoiceDate),
          total: invoice.total,
          paid: invoice.paidAmount,
          status: invoice.status,
        });
      });
    } else if (tab === 'profit' && profit) {
      ws.addRow(['البند', 'القيمة']);
      ws.addRow(['صافي الإيراد', profit.revenue ?? profit.salesTotal]);
      ws.addRow(['تكلفة البضاعة', profit.cogs || 0]);
      ws.addRow(['المصروفات', profit.expenses || 0]);
      ws.addRow(['مجمل الربح', profit.operatingProfit ?? ((profit.revenue ?? profit.salesTotal) - (profit.cogs || 0))]);
      ws.addRow(['صافي الربح', profit.netProfit ?? profit.grossProfit]);
      ws.addRow([]);
      const detail = wb.addWorksheet('تفاصيل الربح');
      detail.columns = [
        { header: 'التاريخ', key: 'date', width: 14 },
        { header: 'النوع', key: 'kind', width: 16 },
        { header: 'المرجع', key: 'reference', width: 14 },
        { header: 'التفاصيل', key: 'description', width: 36 },
        { header: 'الطرف', key: 'party', width: 22 },
        { header: 'الكمية', key: 'quantity', width: 10 },
        { header: 'سعر/تكلفة', key: 'unitAmount', width: 12 },
        { header: 'المبلغ', key: 'amount', width: 14 },
        { header: 'أثر', key: 'side', width: 10 },
      ];
      (profit.lines || []).forEach((row) => {
        detail.addRow({
          date: formatDate(row.date),
          kind: PROFIT_KIND[row.kind].label,
          reference: row.reference,
          description: row.description,
          party: row.party,
          quantity: row.quantity ?? '',
          unitAmount: row.unitAmount ?? '',
          amount: row.side === 'IN' ? row.amount : -row.amount,
          side: row.side === 'IN' ? 'دخل' : 'خرج',
        });
      });
    } else if (tab === 'products' && products) {
      const soldSheet = wb.addWorksheet('الأكثر مبيعاً');
      soldSheet.columns = [
        { header: 'الصنف', key: 'name', width: 28 },
        { header: 'الكود', key: 'sku', width: 14 },
        { header: 'الكمية', key: 'quantity', width: 12 },
        { header: 'الإيراد', key: 'amount', width: 14 },
      ];
      products.topSold.forEach((row) => soldSheet.addRow(row));
      const buySheet = wb.addWorksheet('الأكثر شراءً');
      buySheet.columns = [
        { header: 'الصنف', key: 'name', width: 28 },
        { header: 'الكود', key: 'sku', width: 14 },
        { header: 'الكمية', key: 'quantity', width: 12 },
        { header: 'التكلفة', key: 'amount', width: 14 },
      ];
      products.topPurchased.forEach((row) => buySheet.addRow(row));
      const lossSheet = wb.addWorksheet('الخسارة');
      lossSheet.columns = [
        { header: 'الصنف', key: 'name', width: 28 },
        { header: 'كمية مباعة', key: 'quantity', width: 14 },
        { header: 'إيراد', key: 'revenue', width: 14 },
        { header: 'تكلفة', key: 'cost', width: 14 },
        { header: 'خسارة', key: 'loss', width: 14 },
      ];
      products.losses.forEach((row) => lossSheet.addRow(row));
      const pricedSheet = wb.addWorksheet('تحت التكلفة');
      pricedSheet.columns = [
        { header: 'الصنف', key: 'name', width: 28 },
        { header: 'المخزون', key: 'stockQty', width: 12 },
        { header: 'التكلفة', key: 'costPrice', width: 14 },
        { header: 'سعر البيع', key: 'salePrice', width: 14 },
        { header: 'خسارة متوقعة', key: 'potentialLoss', width: 16 },
      ];
      products.underpriced.forEach((row) => pricedSheet.addRow(row));
      const deadSheet = wb.addWorksheet('لا تباع');
      deadSheet.columns = [
        { header: 'الصنف', key: 'name', width: 28 },
        { header: 'الكود', key: 'sku', width: 14 },
        { header: 'المخزون', key: 'stockQty', width: 12 },
        { header: 'قيمة المخزون', key: 'stockValue', width: 16 },
      ];
      products.unsold.forEach((row) => deadSheet.addRow(row));
    } else if (tab === 'cash' && cash) {
      ws.columns = [
        { header: 'التاريخ', key: 'date', width: 14 },
        { header: 'الحساب', key: 'account', width: 18 },
        { header: 'الوصف', key: 'desc', width: 30 },
        { header: 'النوع', key: 'dir', width: 10 },
        { header: 'المبلغ', key: 'amount', width: 12 },
      ];
      cash.transactions.forEach((t) => {
        ws.addRow({
          date: formatDate(t.createdAt),
          account: t.account.name,
          desc: t.description,
          dir: t.direction === 'IN' ? 'وارد' : 'صادر',
          amount: t.amount,
        });
      });
    }
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${tab}.xlsx`;
    a.click();
  }

  return (
    <div>
      <PageHeader
        title="التقارير"
        subtitle="تقارير مفصّلة لكل أجزاء النظام: مخزون · مبيعات · مشتريات · مالية · عملاء · موارد بشرية · تصنيع"
        actions={
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="بحث في التقرير..." />
            <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> طباعة / PDF</Button>
            <Button variant="secondary" onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</Button>
            <Button onClick={() => load()}><Download size={16} /> تحديث</Button>
          </>
        }
      />

      <PrintHeader title={tab === 'count' ? 'بيان جرد مخزن' : 'تقرير Pro Pack'} subtitle={`${TAB_LABEL[tab]}${applied ? ` · ${applied.all ? 'كل المخازن' : warehouses.filter((row) => applied.ids.includes(row.id)).map((row) => row.name).join('، ')}` : ''}`} />

      <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm no-print">
        {([
          ['inventory', 'المخزون', Boxes],
          ['count', 'بيان جرد', ClipboardCheck],
          ['sales', 'المبيعات', ShoppingCart],
          ['purchases', 'المشتريات', Truck],
          ['products', 'المنتجات', Package],
          ['profit', 'الأرباح', TrendingUp],
          ['cash', 'الخزنة', Wallet],
          ['finance', 'المالية', Coins],
          ['customers', 'العملاء', Users],
          ['suppliers', 'الموردين', Truck],
          ['hr', 'الموارد البشرية', Users],
          ['production', 'التصنيع', Factory],
        ] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex h-11 min-w-[120px] flex-1 items-center justify-center gap-2 rounded-xl text-[13px] font-bold transition ${tab === k ? 'bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <Card className="mb-5 !p-3 no-print">
        <div className="space-y-3">
          <div>
            <Label>المخازن</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${allWarehouses ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  className="accent-[var(--color-brand-700)]"
                  checked={allWarehouses}
                  onChange={() => {
                    if (allWarehouses) {
                      setAllWarehouses(false);
                      setPicked([]);
                    } else {
                      setAllWarehouses(true);
                      setPicked(warehouses.map((row) => row.id));
                    }
                  }}
                />
                كل المخازن
              </label>
              {warehouses.map((row) => {
                const checked = allWarehouses || picked.includes(row.id);
                return (
                  <label key={row.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${checked ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}>
                    <input
                      type="checkbox"
                      className="accent-[var(--color-brand-700)]"
                      checked={checked}
                      onChange={() => {
                        if (allWarehouses) {
                          setAllWarehouses(false);
                          setPicked(warehouses.map((item) => item.id).filter((id) => id !== row.id));
                          return;
                        }
                        setPicked((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]);
                      }}
                    />
                    {row.name}
                  </label>
                );
              })}
            </div>
          </div>
          {!NO_DATES.includes(tab) && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex rounded-xl bg-slate-100 p-1">
                {([['today', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['year', 'السنة']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => applyPreset(key)} className="h-8 rounded-lg px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-brand-800 hover:shadow-sm">{label}</button>
                ))}
              </div>
              <div className="w-40"><Label>من تاريخ</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="w-40"><Label>إلى تاريخ</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          )}
          <Button onClick={showReport} disabled={!ready}>عرض التقرير</Button>
        </div>
      </Card>

      {!applied && (
        <Card>
          <Empty text="التقرير لسه مش ظاهر" hint="اختار مخزن واحد أو أكتر، أو كل المخازن، وبعدين اضغط عرض التقرير" />
        </Card>
      )}

      {applied && tab === 'inventory' && (
        <StatGrid cols={3}>
          <StatCard label="قيمة المخزون بالتكلفة" value={formatMoney(filteredInventory.reduce((s, r) => s + r.quantity * r.product.costPrice, 0))} icon={Coins} tone="brand" />
          <StatCard label="قيمة المخزون بسعر البيع" value={formatMoney(filteredInventory.reduce((s, r) => s + r.quantity * r.product.salePrice, 0))} icon={TrendingUp} tone="emerald" />
          <StatCard label="إجمالي الوحدات" value={filteredInventory.reduce((s, r) => s + r.quantity, 0).toLocaleString('ar-EG')} hint={`${filteredInventory.length} رصيد`} icon={Boxes} tone="sky" />
        </StatGrid>
      )}

      {applied && tab === 'inventory' && (
        <Card>
          {filteredInventory.length === 0 ? <Empty /> : (
            <Table>
              <thead>
                <tr>
                  <Th>المخزن</Th>
                  <Th>الكود</Th>
                  <Th>الصنف</Th>
                  <Th>كمية</Th>
                  <Th>تكلفة</Th>
                  <Th>بيع</Th>
                  <Th>قيمة</Th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map((r, i) => (
                  <tr key={i} className={r.quantity <= 0 ? 'row-credit' : ''}>
                    <Td className="text-slate-600">{r.warehouse.name}</Td>
                    <Td><span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600" dir="ltr">{r.product.sku}</span></Td>
                    <Td className="font-bold text-slate-900">{r.product.name}</Td>
                    <Td className={`font-extrabold tabular-nums ${r.quantity <= 0 ? 'text-rose-600' : ''}`}>{r.quantity}</Td>
                    <Td className="tabular-nums text-slate-600">{formatMoney(r.product.costPrice)}</Td>
                    <Td className="tabular-nums text-slate-600">{formatMoney(r.product.salePrice)}</Td>
                    <Td className="whitespace-nowrap font-bold tabular-nums">{formatMoney(r.quantity * r.product.costPrice)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {applied && tab === 'count' && countSheet && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="font-bold text-slate-700">
              {filteredCount.length} صنف · إجمالي الكميات {filteredCount.reduce((s, r) => s + r.quantity, 0).toLocaleString('ar-EG')}
            </div>
            <div className="text-slate-600">
              آخر جرد: <b>{countSheet.lastCountAt ? formatDate(countSheet.lastCountAt) : 'لم يتم جرد بعد'}</b>
              <span className="mx-2 text-slate-300">|</span>
              تاريخ البيان: <b>{formatDate(new Date().toISOString())}</b>
            </div>
          </div>
          {filteredCount.length === 0 ? <Empty text="لا توجد أرصدة في المخزن المحدد" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>م</Th>
                  <Th>المخزن</Th>
                  <Th>الكود</Th>
                  <Th>الصنف</Th>
                  <Th>المقاس</Th>
                  <Th>الوحدة</Th>
                  <Th>الكمية بالسيستم</Th>
                  <Th>آخر جرد</Th>
                  <Th>الكمية الفعلية</Th>
                  <Th>الفرق</Th>
                </tr>
              </thead>
              <tbody>
                {filteredCount.map((r, i) => (
                  <tr key={`${r.warehouse.id}-${r.product.id}`}>
                    <Td className="tabular-nums text-slate-500">{i + 1}</Td>
                    <Td className="text-slate-600">{r.warehouse.name}</Td>
                    <Td><span className="font-mono text-[11px] text-slate-600" dir="ltr">{r.product.sku}</span></Td>
                    <Td className="font-bold text-slate-900">{r.product.name}</Td>
                    <Td className="whitespace-nowrap">{sizeText(r.product.width, r.product.thickness) || '—'}</Td>
                    <Td>{r.product.unit}</Td>
                    <Td className={`font-extrabold tabular-nums ${r.quantity < 0 ? 'text-rose-600' : ''}`}>{r.quantity.toLocaleString('ar-EG')}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{r.lastCountAt ? formatDate(r.lastCountAt) : '—'}</Td>
                    <Td className="min-w-[6rem] border-b border-dashed border-slate-300"></Td>
                    <Td className="min-w-[4rem] border-b border-dashed border-slate-300"></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="mt-10 grid grid-cols-3 gap-6 text-center text-sm font-bold text-slate-700">
            {['أمين المخزن', 'المراجع', 'المدير'].map((role) => (
              <div key={role}>
                <div className="mb-10">{role}</div>
                <div className="border-t border-slate-400 pt-1 text-xs font-semibold text-slate-500">الاسم / التوقيع</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {applied && tab === 'sales' && sales && (
        <>
        <StatGrid>
          <StatCard label="إجمالي المبيعات" value={formatMoney(sales.total)} icon={ShoppingCart} tone="emerald" />
          <StatCard label="المحصل" value={formatMoney(sales.paid)} hint={sales.total > 0 ? `${((sales.paid / sales.total) * 100).toFixed(0)}% من الإجمالي` : undefined} icon={Wallet} tone="sky" />
          <StatCard label="المتبقي على العملاء" value={formatMoney(Math.max(0, sales.total - sales.paid))} icon={Coins} tone="rose" />
          <StatCard label="عدد الفواتير" value={sales.count} hint={sales.count ? `متوسط ${formatMoney(sales.total / sales.count)}` : undefined} icon={FileSpreadsheet} tone="amber" />
        </StatGrid>
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm no-print">
            <span className="text-xs font-bold text-slate-500">الأعمدة:</span>
            {([['customer', 'العميل'], ['date', 'التاريخ'], ['total', 'الإجمالي'], ['status', 'الحالة']] as const).map(([key, label]) => (
              <label key={key} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${salesCols[key] ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-500'}`}>
                <input type="checkbox" className="accent-[var(--color-brand-700)]" checked={salesCols[key]} onChange={(e) => setSalesCols({ ...salesCols, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th>
                <Th>المخزن</Th>
                {salesCols.customer && <Th>العميل</Th>}
                {salesCols.date && <Th>التاريخ</Th>}
                <Th>الخصم</Th>
                {salesCols.total && <Th>الإجمالي</Th>}
                <Th>المتبقي</Th>
                {salesCols.status && <Th>الحالة</Th>}
              </tr>
            </thead>
            <tbody>
              {sales.invoices.map((i) => (
                <tr key={i.number} className={`status-${i.status}`}>
                  <Td><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{i.number}</span></Td>
                  <Td className="text-slate-600">{i.warehouse.name}</Td>
                  {salesCols.customer && <Td className="font-semibold text-slate-800">{i.customer.name}</Td>}
                  {salesCols.date && <Td className="whitespace-nowrap text-slate-500">{formatDate(i.invoiceDate)}</Td>}
                  <Td className="whitespace-nowrap text-amber-700">{i.discount ? formatMoney(i.discount) : '—'}</Td>
                  {salesCols.total && <Td className="whitespace-nowrap font-bold">{formatMoney(i.total)}</Td>}
                  <Td>{i.status === 'CANCELLED' ? formatMoney(0) : <DueAmount date={i.invoiceDate} remaining={i.total - i.paidAmount} />}</Td>
                  {salesCols.status && <Td><StatusBadge status={i.status} /></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        </>
      )}

      {applied && tab === 'purchases' && purchases && (
        <>
        <StatGrid>
          <StatCard label="إجمالي المشتريات" value={formatMoney(purchases.total)} icon={Truck} tone="sky" />
          <StatCard label="المدفوع للموردين" value={formatMoney(purchases.paid)} hint={purchases.total > 0 ? `${((purchases.paid / purchases.total) * 100).toFixed(0)}% من الإجمالي` : undefined} icon={Wallet} tone="emerald" />
          <StatCard label="المتبقي للموردين" value={formatMoney(Math.max(0, purchases.total - purchases.paid))} icon={Coins} tone="rose" />
          <StatCard label="عدد الفواتير" value={purchases.count} hint={purchases.count ? `متوسط ${formatMoney(purchases.total / purchases.count)}` : undefined} icon={FileSpreadsheet} tone="amber" />
        </StatGrid>
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm no-print">
            <span className="text-xs font-bold text-slate-500">الأعمدة:</span>
            {([['supplier', 'المورد'], ['date', 'التاريخ'], ['total', 'الإجمالي'], ['status', 'الحالة']] as const).map(([key, label]) => (
              <label key={key} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${purchaseCols[key] ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-500'}`}>
                <input type="checkbox" className="accent-[var(--color-brand-700)]" checked={purchaseCols[key]} onChange={(e) => setPurchaseCols({ ...purchaseCols, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          {purchases.invoices.length === 0 ? <Empty text="لا توجد فواتير شراء في المخازن والفترة دي" /> : (
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th>
                <Th>المخزن</Th>
                {purchaseCols.supplier && <Th>المورد</Th>}
                {purchaseCols.date && <Th>التاريخ</Th>}
                {purchaseCols.total && <Th>الإجمالي</Th>}
                <Th>المتبقي</Th>
                {purchaseCols.status && <Th>الحالة</Th>}
              </tr>
            </thead>
            <tbody>
              {purchases.invoices.map((invoice) => (
                <tr key={invoice.number} className={`status-${invoice.status}`}>
                  <Td><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{invoice.number}</span></Td>
                  <Td className="text-slate-600">{invoice.warehouse.name}</Td>
                  {purchaseCols.supplier && <Td className="font-semibold text-slate-800">{invoice.supplier.name}</Td>}
                  {purchaseCols.date && <Td className="whitespace-nowrap text-slate-500">{formatDate(invoice.invoiceDate)}</Td>}
                  {purchaseCols.total && <Td className="whitespace-nowrap font-bold">{formatMoney(invoice.total)}</Td>}
                  <Td>{invoice.status === 'CANCELLED' ? formatMoney(0) : <DueAmount date={invoice.invoiceDate} remaining={invoice.total - invoice.paidAmount} />}</Td>
                  {purchaseCols.status && <Td><StatusBadge status={invoice.status} /></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
          )}
        </Card>
        </>
      )}

      {applied && tab === 'products' && products && (
        <div className="space-y-4">
          <StatGrid>
            <StatCard label="خسارة محققة" value={<span className="text-rose-700">{formatMoney(products.lossTotal)}</span>} hint="بيع بأقل من التكلفة" icon={TrendingDown} tone="rose" />
            <StatCard label="خسارة متوقعة على المخزون" value={<span className="text-amber-700">{formatMoney(products.potentialLossTotal)}</span>} hint="سعر البيع أقل من التكلفة" icon={AlertTriangle} tone="amber" />
            <StatCard label="أصناف لا تُباع" value={products.unsold.length} hint={`قيمة راكدة ${formatMoney(products.unsoldValue)}`} icon={PackageX} tone="slate" />
            <StatCard label="الأكثر مبيعاً" value={visibleSold.length} hint="صنف له مبيعات في الفترة" icon={TrendingUp} tone="emerald" />
          </StatGrid>

          <Card>
            <div className="mb-3 font-bold text-emerald-800">الأكثر مبيعاً</div>
            {visibleSold.length === 0 ? <Empty /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>الصنف</Th>
                    <Th>الكمية</Th>
                    <Th>الإيراد</Th>
                    <Th>متوسط السعر</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSold.map((row, index) => (
                    <tr key={row.productId} className="row-debit">
                      <Td>{index + 1}</Td>
                      <Td>
                        <div className="font-semibold">{row.name}</div>
                        <div className="font-mono text-xs text-muted">{row.sku}</div>
                      </Td>
                      <Td className="font-bold">{row.quantity} {row.unit}</Td>
                      <Td>{formatMoney(row.amount)}</Td>
                      <Td>{formatMoney(row.quantity ? row.amount / row.quantity : 0)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <div className="mb-3 font-bold text-sky-800">الأكثر شراءً</div>
            {visiblePurchased.length === 0 ? <Empty /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>الصنف</Th>
                    <Th>الكمية</Th>
                    <Th>التكلفة</Th>
                    <Th>متوسط التكلفة</Th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePurchased.map((row, index) => (
                    <tr key={row.productId}>
                      <Td>{index + 1}</Td>
                      <Td>
                        <div className="font-semibold">{row.name}</div>
                        <div className="font-mono text-xs text-muted">{row.sku}</div>
                      </Td>
                      <Td className="font-bold">{row.quantity} {row.unit}</Td>
                      <Td>{formatMoney(row.amount)}</Td>
                      <Td>{formatMoney(row.quantity ? row.amount / row.quantity : 0)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <div className="mb-1 font-bold text-rose-800">الخسارة المحققة</div>
            <div className="mb-3 text-xs text-muted">أصناف اتباعت وإيرادها أقل من تكلفتها الحالية</div>
            {visibleLosses.length === 0 ? <Empty /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>الصنف</Th>
                    <Th>كمية مباعة</Th>
                    <Th>إيراد</Th>
                    <Th>تكلفة</Th>
                    <Th>خسارة</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLosses.map((row) => (
                    <tr key={row.productId} className="row-credit">
                      <Td>
                        <div className="font-semibold">{row.name}</div>
                        <div className="font-mono text-xs text-muted">{row.sku}</div>
                      </Td>
                      <Td>{row.quantity}</Td>
                      <Td>{formatMoney(row.revenue)}</Td>
                      <Td>{formatMoney(row.cost)}</Td>
                      <Td className="font-bold text-rose-700">{formatMoney(row.loss)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <div className="mb-1 font-bold text-orange-800">سعر البيع أقل من التكلفة</div>
            <div className="mb-3 text-xs text-muted">خسارة متوقعة لو المخزون الحالي اتباع بسعر البيع المسجّل</div>
            {visibleUnderpriced.length === 0 ? <Empty /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>الصنف</Th>
                    <Th>المخزون</Th>
                    <Th>التكلفة</Th>
                    <Th>سعر البيع</Th>
                    <Th>الفرق</Th>
                    <Th>خسارة متوقعة</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUnderpriced.map((row) => (
                    <tr key={row.productId}>
                      <Td>
                        <div className="font-semibold">{row.name}</div>
                        <div className="font-mono text-xs text-muted">{row.sku}</div>
                      </Td>
                      <Td>{row.stockQty}</Td>
                      <Td>{formatMoney(row.costPrice)}</Td>
                      <Td>{formatMoney(row.salePrice)}</Td>
                      <Td>{formatMoney(row.gap)}</Td>
                      <Td className="font-bold text-orange-700">{formatMoney(row.potentialLoss)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <div className="mb-1 font-bold text-amber-900">منتجات لا تُباع</div>
            <div className="mb-3 text-xs text-muted">مخزون أو مشتريات من غير أي بيع في الفترة</div>
            {visibleUnsold.length === 0 ? <Empty /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>الصنف</Th>
                    <Th>المخزون</Th>
                    <Th>قيمة المخزون</Th>
                    <Th>مشترى</Th>
                    <Th>التكلفة</Th>
                    <Th>سعر البيع</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUnsold.map((row) => (
                    <tr key={row.productId}>
                      <Td>
                        <div className="font-semibold">{row.name}</div>
                        <div className="font-mono text-xs text-muted">{row.sku}</div>
                      </Td>
                      <Td className="font-bold">{row.stockQty} {row.unit}</Td>
                      <Td>{formatMoney(row.stockValue)}</Td>
                      <Td>{row.purchasedQty}</Td>
                      <Td>{formatMoney(row.costPrice)}</Td>
                      <Td>{formatMoney(row.salePrice)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {applied && tab === 'profit' && profit && (
        <ProfitView
          revenue={profit.revenue ?? profit.salesTotal}
          cogs={profit.cogs || 0}
          expenses={profit.expenses || 0}
          incomes={profit.incomes || 0}
          gross={profit.operatingProfit ?? ((profit.revenue ?? profit.salesTotal) - (profit.cogs || 0))}
          net={profit.netProfit ?? profit.grossProfit}
          invoiceDiff={profit.grossProfit}
          lines={profit.lines || []}
        />
      )}

      {applied && tab === 'cash' && cash && (
        <>
        {!applied.all && <p className="mb-3 text-sm text-slate-500">الحركات هنا هي التحصيل والسداد المرتبطين بفواتير المخازن المختارة.</p>}
        <StatGrid cols={3}>
          <StatCard label="وارد" value={<span className="text-emerald-700">{formatMoney(cash.totalIn)}</span>} icon={ArrowDownLeft} tone="emerald" />
          <StatCard label="صادر" value={<span className="text-rose-600">{formatMoney(cash.totalOut)}</span>} icon={ArrowUpRight} tone="rose" />
          <StatCard label="صافي الحركة" value={formatMoney(cash.net)} hint={`${cash.transactions.length} حركة`} icon={Wallet} tone="brand" />
        </StatGrid>
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>التاريخ</Th>
                <Th>الحساب</Th>
                <Th>الوصف</Th>
                <Th>النوع</Th>
                <Th>المبلغ</Th>
              </tr>
            </thead>
            <tbody>
              {cash.transactions.map((t, i) => (
                <tr key={i} className={t.direction === 'IN' ? 'row-debit' : 'row-credit'}>
                  <Td className="whitespace-nowrap text-slate-500">{formatDate(t.createdAt)}</Td>
                  <Td className="font-semibold text-slate-700">{t.account.name}</Td>
                  <Td className="text-slate-600">{t.description}</Td>
                  <Td><Badge tone={t.direction === 'IN' ? 'emerald' : 'rose'}>{t.direction === 'IN' ? 'وارد' : 'صادر'}</Badge></Td>
                  <Td className={`whitespace-nowrap font-extrabold ${t.direction === 'IN' ? 'text-emerald-700' : 'text-rose-600'}`}>{formatMoney(t.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        </>
      )}

      {applied && tab === 'customers' && customersReport && (
        <>
          <StatGrid>
            <StatCard label="عدد العملاء" value={String(customersReport.count)} icon={Users} tone="brand" />
            <StatCard label="مستحق على العملاء" value={formatMoney(customersReport.totalDue)} hint={`${customersReport.dueCount} عميل`} icon={ArrowUpRight} tone="rose" />
            <StatCard label="دفعات مقدمة" value={formatMoney(customersReport.totalPrepaid)} hint={`${customersReport.prepaidCount} عميل`} icon={ArrowDownLeft} tone="emerald" />
          </StatGrid>
          <Card>
            <CardHeader title="تفاصيل أرصدة العملاء" subtitle="كشف مختصر لكل عميل نشط" icon={Users} />
            <Table>
              <thead><tr><Th>الكود</Th><Th>الاسم</Th><Th>الهاتف</Th><Th>فواتير</Th><Th>تحصيلات</Th><Th>الرصيد</Th></tr></thead>
              <tbody>
                {(customersReport.customers || []).filter((c) => {
                  const q = search.trim().toLowerCase();
                  return !q || [c.code, c.name, c.phone || ''].some((x) => x.toLowerCase().includes(q));
                }).map((c) => (
                  <tr key={c.id} className={c.balance > 0.009 ? 'row-credit' : c.balance < -0.009 ? 'row-debit' : ''}>
                    <Td className="font-mono text-xs" dir="ltr">{c.code}</Td>
                    <Td className="font-bold">{c.name}</Td>
                    <Td className="text-slate-500">{c.phone || '—'}</Td>
                    <Td>{c._count.salesInvoices}</Td>
                    <Td>{c._count.receipts}</Td>
                    <Td className={`font-extrabold ${c.balance > 0.009 ? 'text-rose-600' : c.balance < -0.009 ? 'text-emerald-700' : 'text-slate-700'}`}>{formatMoney(c.balance)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {applied && tab === 'suppliers' && suppliersReport && (
        <>
          <StatGrid>
            <StatCard label="عدد الموردين" value={String(suppliersReport.count)} icon={Truck} tone="brand" />
            <StatCard label="مستحق للموردين" value={formatMoney(suppliersReport.totalDue)} hint={`${suppliersReport.dueCount} مورد`} icon={ArrowUpRight} tone="rose" />
            <StatCard label="دفعات مقدمة" value={formatMoney(suppliersReport.totalPrepaid)} hint={`${suppliersReport.prepaidCount} مورد`} icon={ArrowDownLeft} tone="emerald" />
          </StatGrid>
          <Card>
            <CardHeader title="تفاصيل أرصدة الموردين" subtitle="كشف مختصر لكل مورد نشط" icon={Truck} />
            <Table>
              <thead><tr><Th>الكود</Th><Th>الاسم</Th><Th>الهاتف</Th><Th>فواتير</Th><Th>سدادات</Th><Th>الرصيد</Th></tr></thead>
              <tbody>
                {(suppliersReport.suppliers || []).filter((c) => {
                  const q = search.trim().toLowerCase();
                  return !q || [c.code, c.name, c.phone || ''].some((x) => x.toLowerCase().includes(q));
                }).map((c) => (
                  <tr key={c.id} className={c.balance > 0.009 ? 'row-credit' : c.balance < -0.009 ? 'row-debit' : ''}>
                    <Td className="font-mono text-xs" dir="ltr">{c.code}</Td>
                    <Td className="font-bold">{c.name}</Td>
                    <Td className="text-slate-500">{c.phone || '—'}</Td>
                    <Td>{c._count.purchaseInvoices}</Td>
                    <Td>{c._count.payments}</Td>
                    <Td className={`font-extrabold ${c.balance > 0.009 ? 'text-rose-600' : c.balance < -0.009 ? 'text-emerald-700' : 'text-slate-700'}`}>{formatMoney(c.balance)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {applied && tab === 'finance' && financeReport && (
        <div className="space-y-4">
          <StatGrid>
            <StatCard label="إجمالي الواردات" value={formatMoney(financeReport.incomeTotal)} icon={ArrowDownLeft} tone="emerald" />
            <StatCard label="إجمالي المصروفات" value={formatMoney(financeReport.expenseTotal)} icon={ArrowUpRight} tone="rose" />
            <StatCard label="صافي المالية" value={formatMoney(financeReport.net)} icon={Coins} tone={financeReport.net >= 0 ? 'emerald' : 'rose'} />
            <StatCard label="تحويلات الخزنة" value={formatMoney(financeReport.transferTotal)} hint={`${financeReport.transfers.length} تحويل · شيكات معلقة ${financeReport.pendingChecks}`} icon={ArrowLeftRight} tone="sky" />
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="الواردات بالتفصيل" subtitle={`${financeReport.incomes.length} حركة`} icon={ArrowDownLeft} />
              {financeReport.incomes.length === 0 ? <Empty /> : (
                <Table>
                  <thead><tr><Th>التاريخ</Th><Th>البند</Th><Th>الحساب</Th><Th>المبلغ</Th></tr></thead>
                  <tbody>
                    {financeReport.incomes.map((row) => (
                      <tr key={row.id} className="row-debit">
                        <Td className="whitespace-nowrap text-slate-500">{formatDate(row.incomeDate)}</Td>
                        <Td><Badge tone="emerald">{row.category.name}</Badge></Td>
                        <Td>{row.account.name}</Td>
                        <Td className="font-extrabold text-emerald-700">{formatMoney(row.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader title="المصروفات بالتفصيل" subtitle={`${financeReport.expenses.length} مصروف`} icon={ArrowUpRight} />
              {financeReport.expenses.length === 0 ? <Empty /> : (
                <Table>
                  <thead><tr><Th>التاريخ</Th><Th>البند</Th><Th>الحساب</Th><Th>المبلغ</Th></tr></thead>
                  <tbody>
                    {financeReport.expenses.map((row) => (
                      <tr key={row.id} className="row-credit">
                        <Td className="whitespace-nowrap text-slate-500">{formatDate(row.expenseDate)}</Td>
                        <Td><Badge tone="amber">{row.category.name}</Badge></Td>
                        <Td>{row.account.name}</Td>
                        <Td className="font-extrabold text-rose-600">{formatMoney(row.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
          <Card>
            <CardHeader title="تحويلات بين الخزائن" subtitle={`${financeReport.transfers.length} تحويل`} icon={ArrowLeftRight} />
            {financeReport.transfers.length === 0 ? <Empty text="لا توجد تحويلات في الفترة" /> : (
              <Table>
                <thead><tr><Th>الرقم</Th><Th>التاريخ</Th><Th>من</Th><Th>إلى</Th><Th>المبلغ</Th><Th>ملاحظة</Th></tr></thead>
                <tbody>
                  {financeReport.transfers.map((row) => (
                    <tr key={row.id}>
                      <Td className="font-mono text-xs" dir="ltr">{row.number}</Td>
                      <Td>{formatDate(row.createdAt)}</Td>
                      <Td className="text-rose-700">{row.fromAccount.name}</Td>
                      <Td className="text-emerald-700">{row.toAccount.name}</Td>
                      <Td className="font-extrabold">{formatMoney(row.amount)}</Td>
                      <Td className="text-muted">{row.note || '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="الشيكات" subtitle={`${financeReport.checks.length} شيك`} icon={FileSpreadsheet} />
            {financeReport.checks.length === 0 ? <Empty /> : (
              <Table>
                <thead><tr><Th>الرقم</Th><Th>الاتجاه</Th><Th>البنك</Th><Th>الاستحقاق</Th><Th>الطرف</Th><Th>الحالة</Th><Th>المبلغ</Th></tr></thead>
                <tbody>
                  {financeReport.checks.map((row) => (
                    <tr key={row.id}>
                      <Td className="font-mono text-xs" dir="ltr">{row.checkNumber}</Td>
                      <Td><Badge tone={row.direction === 'IN' ? 'emerald' : 'rose'}>{row.direction === 'IN' ? 'وارد' : 'صادر'}</Badge></Td>
                      <Td>{row.bankName}</Td>
                      <Td>{formatDate(row.dueDate)}</Td>
                      <Td>{row.customer?.name || row.supplier?.name || '—'}</Td>
                      <Td><Badge tone={row.status === 'PENDING' ? 'amber' : row.status === 'CLEARED' ? 'emerald' : 'rose'}>{row.status}</Badge></Td>
                      <Td className="font-extrabold">{formatMoney(row.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {applied && tab === 'hr' && hrReport && (
        <div className="space-y-4">
          <StatGrid>
            <StatCard label="الموظفون" value={String(hrReport.employeeCount)} hint={`مرتبات أساسية ${formatMoney(hrReport.salaryTotal)}`} icon={Users} tone="brand" />
            <StatCard label="الحضور" value={String(hrReport.attendanceCount)} hint={`إضافي معتمد ${(hrReport.overtimeMinutes / 60).toFixed(1)} س`} icon={ClipboardCheck} tone="sky" />
            <StatCard label="الإجازات" value={String(hrReport.leaveCount)} icon={AlertTriangle} tone="amber" />
            <StatCard label="حركات مالية" value={formatMoney(hrReport.movementTotal)} hint={`${hrReport.movements.length} حركة`} icon={Coins} tone="emerald" />
          </StatGrid>
          <Card>
            <CardHeader title="قائمة الموظفين" subtitle="الرواتب والعمولة والنشاط" icon={Users} />
            <Table>
              <thead><tr><Th>الكود</Th><Th>الاسم</Th><Th>الراتب</Th><Th>عمولة %</Th><Th>حضور</Th><Th>إجازات</Th><Th>حركات</Th></tr></thead>
              <tbody>
                {hrReport.employees.filter((e) => {
                  const q = search.trim().toLowerCase();
                  return !q || [e.code, e.name].some((x) => x.toLowerCase().includes(q));
                }).map((e) => (
                  <tr key={e.id}>
                    <Td className="font-mono text-xs" dir="ltr">{e.code}</Td>
                    <Td className="font-bold">{e.name}</Td>
                    <Td>{formatMoney(e.salary)}</Td>
                    <Td>{e.commissionPercent}%</Td>
                    <Td>{e._count.attendance}</Td>
                    <Td>{e._count.leaves}</Td>
                    <Td>{e._count.movements}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="الحضور في الفترة" subtitle={`${hrReport.attendance.length} سجل`} icon={ClipboardCheck} />
              <Table>
                <thead><tr><Th>التاريخ</Th><Th>الموظف</Th><Th>الحالة</Th><Th>تأخير</Th><Th>إضافي</Th></tr></thead>
                <tbody>
                  {hrReport.attendance.slice(0, 100).map((a) => (
                    <tr key={a.id}>
                      <Td>{formatDate(a.workDate)}</Td>
                      <Td>{a.employee.name}</Td>
                      <Td><Badge tone="sky">{a.status}</Badge></Td>
                      <Td>{a.lateMinutes} د</Td>
                      <Td>{a.overtimeMinutes} د{a.overtimeApproved ? ' ✓' : ''}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="الحركات المالية" subtitle={`${hrReport.movements.length} حركة`} icon={Coins} />
              <Table>
                <thead><tr><Th>التاريخ</Th><Th>الموظف</Th><Th>النوع</Th><Th>المبلغ</Th></tr></thead>
                <tbody>
                  {hrReport.movements.slice(0, 100).map((m) => (
                    <tr key={m.id}>
                      <Td>{formatDate(m.movementDate)}</Td>
                      <Td>{m.employee.name}</Td>
                      <Td><Badge tone="slate">{m.kind}</Badge></Td>
                      <Td className="font-extrabold">{formatMoney(m.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>
          <Card>
            <CardHeader title="مسيرات الرواتب" subtitle={`${hrReport.payroll.length} مسير`} icon={FileSpreadsheet} />
            {hrReport.payroll.length === 0 ? <Empty text="لا توجد مسيرات في الفترة" /> : (
              <Table>
                <thead><tr><Th>الرقم</Th><Th>الفترة</Th><Th>الحالة</Th><Th>صافي المسير</Th><Th>عدد البنود</Th></tr></thead>
                <tbody>
                  {hrReport.payroll.map((p) => (
                    <tr key={p.id}>
                      <Td className="font-mono text-xs" dir="ltr">{p.number}</Td>
                      <Td>{formatDate(p.fromDate)} → {formatDate(p.toDate)}</Td>
                      <Td><Badge tone={p.status === 'POSTED' ? 'emerald' : 'amber'}>{p.status}</Badge></Td>
                      <Td className="font-extrabold">{formatMoney(p.totalNet)}</Td>
                      <Td>{p.lines.length}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {applied && tab === 'production' && productionReport && (
        <div className="space-y-4">
          <StatGrid>
            <StatCard label="أوامر الإنتاج" value={String(productionReport.orderCount)} hint={formatMoney(productionReport.orderCost)} icon={Factory} tone="brand" />
            <StatCard label="أوامر التصنيع (مراحل)" value={String(productionReport.jobCount)} hint={formatMoney(productionReport.jobCost)} icon={Package} tone="sky" />
            <StatCard label="إجمالي تكلفة التصنيع" value={formatMoney(productionReport.totalCost)} icon={Coins} tone="amber" />
          </StatGrid>
          <Card>
            <CardHeader title="أوامر الإنتاج" subtitle="من الوصفات" icon={Factory} />
            {productionReport.orders.length === 0 ? <Empty /> : (
              <Table>
                <thead><tr><Th>الرقم</Th><Th>المنتج</Th><Th>الكمية</Th><Th>من</Th><Th>إلى</Th><Th>الحالة</Th><Th>التكلفة</Th><Th>التاريخ</Th></tr></thead>
                <tbody>
                  {productionReport.orders.map((o) => (
                    <tr key={o.id}>
                      <Td className="font-mono text-xs" dir="ltr">{o.number}</Td>
                      <Td className="font-bold">{o.product.name}</Td>
                      <Td>{o.quantity}</Td>
                      <Td>{o.rawWarehouse.name}</Td>
                      <Td>{o.finishedWarehouse.name}</Td>
                      <Td><Badge tone="sky">{o.status}</Badge></Td>
                      <Td className="font-extrabold">{formatMoney(o.totalCost)}</Td>
                      <Td>{formatDate(o.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="أوامر التصنيع بالمراحل" subtitle="طباعة · تبطين · سلتر · تفصيل" icon={Package} />
            {productionReport.jobs.length === 0 ? <Empty /> : (
              <Table>
                <thead><tr><Th>الرقم</Th><Th>العنوان / المنتج</Th><Th>المراحل</Th><Th>الحالة</Th><Th>التكلفة</Th><Th>التاريخ</Th></tr></thead>
                <tbody>
                  {productionReport.jobs.map((j) => (
                    <tr key={j.id}>
                      <Td className="font-mono text-xs" dir="ltr">{j.number}</Td>
                      <Td className="font-bold">{j.title || j.finishedProduct?.name || '—'}</Td>
                      <Td className="text-xs text-slate-600">{j.stages.map((s) => s.kind).join(' · ') || '—'}</Td>
                      <Td><Badge tone="sky">{j.status}</Badge></Td>
                      <Td className="font-extrabold">{formatMoney(j.totalCost)}</Td>
                      <Td>{formatDate(j.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
