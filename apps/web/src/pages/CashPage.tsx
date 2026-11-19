import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, Printer, Wallet, Banknote, Building2,
} from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { dueTone } from '../lib/due';
import { DueAmount } from '../components/DueAmount';
import { useToast } from '../lib/feedback';
import {
  Badge, Button, Card, CardHeader, Empty, Input, Label, Modal, NumberInput, PageHeader, Pager, PrintHeader, SearchBox, Select, StatCard, StatGrid, Table, Td, Th,
} from '../components/ui';

type PayMethod = {
  id: string; code: string; name: string; kind: 'IMMEDIATE' | 'CHECK';
  cashAccountId?: string | null; cashAccount?: { balance: number } | null;
};

type Account = { id: string; code: string; name: string; balance: number; accountType?: string };
type Tx = {
  id: string; direction: 'IN' | 'OUT'; amount: number; description: string; createdAt: string;
  paymentMethod?: string; reference?: string | null;
  voucherKind?: 'RECEIPT' | 'PAYOUT' | 'MANUAL' | null;
  voucherNumber?: string | null;
  receivedBy?: string | null;
  deliveredBy?: string | null;
  createdBy?: { fullName: string } | null;
  account: { id?: string; name: string };
};

const VOUCHER_LABEL = (t: Pick<Tx, 'voucherKind' | 'direction'>) =>
  t.voucherKind === 'RECEIPT' ? 'إذن استلام نقدية' : t.voucherKind === 'PAYOUT' ? 'إذن صرف نقدية' : t.direction === 'IN' ? 'حركة وارد' : 'حركة صادر';
type Party = { id: string; name: string; balance?: number; code?: string };
type OpenInvoice = {
  id: string; number: string; total: number; paidAmount: number; remaining: number; status: string; invoiceDate: string;
};
type Receipt = {
  id: string; number: string; amount: number; paymentMethod: string; receivedAt: string;
  referenceNo?: string | null; note?: string | null;
  customer: { name: string }; cashAccount?: { id?: string; name: string } | null;
  salesInvoice?: { number: string } | null;
};
type Payment = {
  id: string; number: string; amount: number; paymentMethod: string; paidAt: string;
  referenceNo?: string | null; note?: string | null;
  supplier: { name: string }; cashAccount?: { id?: string; name: string } | null;
  purchaseInvoice?: { number: string } | null;
};

type CashTransfer = {
  id: string; number: string; amount: number; note?: string | null; createdAt: string;
  fromAccount: { id: string; name: string; code: string };
  toAccount: { id: string; name: string; code: string };
  createdBy?: { fullName: string } | null;
};

type Tab = 'overview' | 'detail' | 'receipts' | 'payments' | 'transfers' | 'movements';

function oldestOpen(rows: OpenInvoice[]) {
  const open = rows.filter((row) => row.remaining > 0.009);
  const source = open.length ? open : rows;
  return source.reduce((best, row) => (row.invoiceDate < best ? row.invoiceDate : best), source[0].invoiceDate);
}

function dueBox(rows: OpenInvoice[]) {
  const tones = rows.filter((row) => row.remaining > 0.009).map((row) => dueTone(row.invoiceDate, row.remaining));
  if (tones.includes('red')) return 'border-rose-200 bg-rose-50';
  if (tones.includes('yellow')) return 'border-amber-200 bg-amber-50';
  if (tones.includes('green')) return 'border-emerald-200 bg-emerald-50';
  return 'border-slate-200 bg-slate-50';
}

export function CashPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountTxs, setAccountTxs] = useState<Tx[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [transfers, setTransfers] = useState<CashTransfer[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);

  const [txOpen, setTxOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [accOpen, setAccOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const [txForm, setTxForm] = useState({
    accountId: '', direction: 'IN' as 'IN' | 'OUT', amount: '' as number | '', description: '',
    voucherKind: 'RECEIPT' as 'RECEIPT' | 'PAYOUT' | 'MANUAL',
    receivedBy: '', deliveredBy: '',
  });
  const [printTx, setPrintTx] = useState<Tx | null>(null);
  const [receiptForm, setReceiptForm] = useState({
    customerId: '', methodId: '', amount: '' as number | '', salesInvoiceId: '',
    referenceNo: '', note: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    supplierId: '', methodId: '', amount: '' as number | '', purchaseInvoiceId: '',
    referenceNo: '', note: '',
  });
  const [accForm, setAccForm] = useState({ name: '', balance: '' as number | '', kind: 'IMMEDIATE', accountType: 'CASH' });
  const [transferForm, setTransferForm] = useState({
    fromAccountId: '', toAccountId: '', amount: '' as number | '', note: '',
  });

  const [customerSummary, setCustomerSummary] = useState<{ balance: number; openInvoices: OpenInvoice[] } | null>(null);
  const [supplierSummary, setSupplierSummary] = useState<{ balance: number; openInvoices: OpenInvoice[] } | null>(null);
  const [search, setSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totals, setTotals] = useState({ receipts: 0, payments: 0, movements: 0, transfers: 0 });
  const [amounts, setAmounts] = useState({ receipts: 0, payments: 0, transfers: 0 });

  async function load() {
    const params = new URLSearchParams({ page: String(listPage), pageSize: String(pageSize) });
    if (search.trim()) params.set('q', search.trim());
    const [a, m, t, tr, c, s, r, p] = await Promise.all([
      api<Account[]>('/cash/accounts'),
      api<PayMethod[]>('/cash/methods'),
      api<{ items: Tx[]; total: number }>(`/cash/transactions?${params}`),
      api<{ items: CashTransfer[]; total: number; amount: number }>(`/cash/transfers?${params}`),
      api<Party[]>('/customers'),
      api<Party[]>('/suppliers'),
      api<{ items: Receipt[]; total: number; amount: number }>(`/cash/receipts?${params}`),
      api<{ items: Payment[]; total: number; amount: number }>(`/cash/payments?${params}`),
    ]);
    setAccounts(a);
    setMethods(m);
    setTxs(t.items);
    setTransfers(tr.items);
    setCustomers(c);
    setSuppliers(s);
    setReceipts(r.items);
    setPayments(p.items);
    setTotals({ receipts: r.total, payments: p.total, movements: t.total, transfers: tr.total });
    setAmounts({ receipts: r.amount, payments: p.amount, transfers: tr.amount });
  }

  useEffect(() => { setListPage(1); }, [search, pageSize]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load().catch(() => undefined); }, 200);
    return () => window.clearTimeout(timer);
  }, [listPage, pageSize, search]);

  useEffect(() => {
    if (!selectedAccountId) {
      setAccountTxs([]);
      return;
    }
    api<{ items: Tx[] } | Tx[]>(`/cash/transactions?accountId=${selectedAccountId}&page=1&pageSize=200`)
      .then((data) => setAccountTxs(Array.isArray(data) ? data : data.items || []))
      .catch(() => setAccountTxs([]));
  }, [selectedAccountId, txs]);

  function openAccount(accountId: string) {
    setSelectedAccountId(accountId);
    setTab('detail');
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;
  const detailReceipts = useMemo(
    () => receipts.filter((r) => r.cashAccount?.id === selectedAccountId || r.cashAccount?.name === selectedAccount?.name),
    [receipts, selectedAccountId, selectedAccount?.name],
  );
  const detailPayments = useMemo(
    () => payments.filter((p) => p.cashAccount?.id === selectedAccountId || p.cashAccount?.name === selectedAccount?.name),
    [payments, selectedAccountId, selectedAccount?.name],
  );
  const detailTransfers = useMemo(
    () => transfers.filter((t) => t.fromAccount.id === selectedAccountId || t.toAccount.id === selectedAccountId),
    [transfers, selectedAccountId],
  );
  const detailIn = accountTxs.filter((t) => t.direction === 'IN').reduce((s, t) => s + t.amount, 0);
  const detailOut = accountTxs.filter((t) => t.direction !== 'IN').reduce((s, t) => s + t.amount, 0);

  const filteredReceipts = receipts;
  const filteredPayments = payments;
  const filteredTxs = txs;
  const pageCount = (count: number) => Math.max(1, Math.ceil(count / pageSize));
  const pageFrom = (count: number) => (count === 0 ? 0 : (Math.min(listPage, pageCount(count)) - 1) * pageSize + 1);
  const pageTo = (count: number) => Math.min(Math.min(listPage, pageCount(count)) * pageSize, count);

  useEffect(() => {
    if (!receiptForm.customerId) {
      setCustomerSummary(null);
      return;
    }
    api<{ balance: number; openInvoices: OpenInvoice[] }>(`/cash/customers/${receiptForm.customerId}/summary`)
      .then(setCustomerSummary)
      .catch(() => setCustomerSummary(null));
  }, [receiptForm.customerId]);

  useEffect(() => {
    if (!paymentForm.supplierId) {
      setSupplierSummary(null);
      return;
    }
    api<{ balance: number; openInvoices: OpenInvoice[] }>(`/cash/suppliers/${paymentForm.supplierId}/summary`)
      .then(setSupplierSummary)
      .catch(() => setSupplierSummary(null));
  }, [paymentForm.supplierId]);

  async function saveTx() {
    const voucherKind = txForm.voucherKind;
    const direction = voucherKind === 'RECEIPT' ? 'IN' : voucherKind === 'PAYOUT' ? 'OUT' : txForm.direction;
    const created = await api<Tx>('/cash/transactions', {
      method: 'POST',
      body: JSON.stringify({
        accountId: txForm.accountId,
        direction,
        amount: txForm.amount === '' ? 0 : txForm.amount,
        description: txForm.description,
        voucherKind,
        receivedBy: txForm.receivedBy.trim() || undefined,
        deliveredBy: txForm.deliveredBy.trim() || undefined,
      }),
    });
    setTxOpen(false);
    setTxForm({ accountId: '', direction: 'IN', amount: '', description: '', voucherKind: 'RECEIPT', receivedBy: '', deliveredBy: '' });
    setTab('movements');
    load();
    if (created.voucherKind !== 'MANUAL') setPrintTx(created);
  }

  async function saveReceipt() {
    await api('/cash/receipts', {
      method: 'POST',
      body: JSON.stringify({
        customerId: receiptForm.customerId,
        methodId: receiptForm.methodId,
        amount: receiptForm.amount === '' ? 0 : receiptForm.amount,
        salesInvoiceId: receiptForm.salesInvoiceId || undefined,
        referenceNo: receiptForm.referenceNo || undefined,
        note: receiptForm.note || undefined,
      }),
    });
    setReceiptOpen(false);
    setReceiptForm({
      customerId: '', methodId: '', amount: '', salesInvoiceId: '',
      referenceNo: '', note: '',
    });
    setTab('receipts');
    load();
  }

  async function savePayment() {
    await api('/cash/payments', {
      method: 'POST',
      body: JSON.stringify({
        supplierId: paymentForm.supplierId,
        methodId: paymentForm.methodId,
        amount: paymentForm.amount === '' ? 0 : paymentForm.amount,
        purchaseInvoiceId: paymentForm.purchaseInvoiceId || undefined,
        referenceNo: paymentForm.referenceNo || undefined,
        note: paymentForm.note || undefined,
      }),
    });
    setPaymentOpen(false);
    setPaymentForm({
      supplierId: '', methodId: '', amount: '', purchaseInvoiceId: '',
      referenceNo: '', note: '',
    });
    setTab('payments');
    load();
  }

  async function saveAccount() {
    try {
      await api('/cash/methods', {
        method: 'POST',
        body: JSON.stringify({
          ...accForm,
          balance: accForm.balance === '' ? 0 : accForm.balance,
        }),
      });
      setAccOpen(false);
      setAccForm({ name: '', balance: '', kind: 'IMMEDIATE', accountType: 'CASH' });
      toast.success('تمت إضافة الخزنة / طريقة الدفع');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إضافة طريقة الدفع');
    }
  }

  async function saveTransfer() {
    if (!transferForm.fromAccountId || !transferForm.toAccountId) {
      toast.error('اختر من وإلى');
      return;
    }
    if (transferForm.fromAccountId === transferForm.toAccountId) {
      toast.error('اختر حسابين مختلفين');
      return;
    }
    const amount = transferForm.amount === '' ? 0 : transferForm.amount;
    if (amount <= 0) {
      toast.error('أدخل مبلغًا أكبر من صفر');
      return;
    }
    try {
      await api('/cash/transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromAccountId: transferForm.fromAccountId,
          toAccountId: transferForm.toAccountId,
          amount,
          note: transferForm.note.trim() || undefined,
        }),
      });
      setTransferOpen(false);
      setTransferForm({ fromAccountId: '', toAccountId: '', amount: '', note: '' });
      setTab('transfers');
      toast.success('تم التحويل بين الحسابات');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تنفيذ التحويل');
    }
  }

  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const cashAccounts = useMemo(() => accounts.filter((a) => (a.accountType || 'CASH') === 'CASH'), [accounts]);
  const walletAccounts = useMemo(() => accounts.filter((a) => a.accountType === 'WALLET'), [accounts]);
  const bankAccounts = useMemo(() => accounts.filter((a) => a.accountType === 'BANK'), [accounts]);

  const cashTotal = cashAccounts.reduce((s, a) => s + a.balance, 0);
  const walletTotal = walletAccounts.reduce((s, a) => s + a.balance, 0);
  const bankTotal = bankAccounts.reduce((s, a) => s + a.balance, 0);
  const inflow = txs.filter((t) => t.direction === 'IN').reduce((s, t) => s + t.amount, 0);
  const outflow = txs.filter((t) => t.direction !== 'IN').reduce((s, t) => s + t.amount, 0);
  const netFlow = inflow - outflow;
  const methodName = (id?: string | null) => methods.find((m) => m.id === id)?.name || '—';
  const payMethods = methods.filter((m) => m.kind !== 'CHECK');

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'الحسابات', count: accounts.length },
    ...(selectedAccount ? [{ id: 'detail' as Tab, label: selectedAccount.name, count: accountTxs.length }] : []),
    { id: 'receipts', label: 'التحصيلات', count: receipts.length },
    { id: 'payments', label: 'السدادات', count: payments.length },
    { id: 'transfers', label: 'التحويلات', count: transfers.length },
    { id: 'movements', label: 'أذون الصرف/الاستلام', count: txs.length },
  ];

  return (
    <div>
      <PageHeader
        title="الخزنة"
        subtitle="خزائن وطرق دفع · تحويل بين الحسابات · تحصيل و سداد"
        actions={
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="بحث في الخزنة..." />
            <Button variant="secondary" onClick={() => setAccOpen(true)}><Plus size={16} /> خزنة / طريقة دفع</Button>
            <Button variant="secondary" onClick={() => setTransferOpen(true)}><ArrowLeftRight size={16} /> تحويل</Button>
            <Button variant="secondary" onClick={() => setReceiptOpen(true)}><ArrowDownLeft size={16} /> تحصيل عميل</Button>
            <Button variant="secondary" onClick={() => setPaymentOpen(true)}><ArrowUpRight size={16} /> سداد مورد</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setTxForm({ accountId: '', direction: 'IN', amount: '', description: '', voucherKind: 'RECEIPT', receivedBy: '', deliveredBy: '' });
                setTxOpen(true);
              }}
            >
              إذن استلام
            </Button>
            <Button
              onClick={() => {
                setTxForm({ accountId: '', direction: 'OUT', amount: '', description: '', voucherKind: 'PAYOUT', receivedBy: '', deliveredBy: '' });
                setTxOpen(true);
              }}
            >
              إذن صرف
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatCard label="إجمالي الأرصدة" value={formatMoney(total)} hint={`${accounts.length} حساب · ${payMethods.length} طريقة دفع`} icon={Wallet} tone="brand" />
        <StatCard label="خزنة رئيسية" value={formatMoney(cashTotal)} hint={`${cashAccounts.length} خزنة`} icon={Banknote} tone="emerald" />
        <StatCard label="انستا باي / محفظة" value={formatMoney(walletTotal)} hint={`${walletAccounts.length} محفظة`} icon={Wallet} tone="sky" />
        <StatCard label="حساب بنكي" value={formatMoney(bankTotal)} hint={`${bankAccounts.length} حساب · صافي ${formatMoney(netFlow)}`} icon={Building2} tone={netFlow >= 0 ? 'emerald' : 'rose'} />
      </StatGrid>

      <div className="mb-4 flex w-fit max-w-full flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm no-print">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-bold transition ${tab === t.id ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {t.label}
            {t.count !== undefined && <span className={`rounded-md px-1.5 text-[11px] tabular-nums ${tab === t.id ? 'bg-white/20' : 'bg-slate-100'}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
        <div className="grid gap-4 lg:grid-cols-3">
          {([
            ['خزنة رئيسية', cashAccounts, Banknote, 'from-emerald-500 to-teal-800'],
            ['انستا باي / محفظة', walletAccounts, Wallet, 'from-sky-500 to-indigo-800'],
            ['حساب بنكي', bankAccounts, Building2, 'from-brand-600 to-brand-950'],
          ] as const).map(([title, list, Icon, gradient]) => (
            <Card key={title}>
              <CardHeader title={title} subtitle={`الإجمالي ${formatMoney(list.reduce((s, a) => s + a.balance, 0))}`} icon={Icon} />
              {list.length === 0 ? <Empty text={`لا توجد ${title}`} /> : (
                <div className="grid gap-3">
                  {list.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => openAccount(a.id)}
                      className={`relative w-full overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-4 text-right text-white shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40`}
                    >
                      <div className="pointer-events-none absolute -left-6 -top-8 h-24 w-24 rounded-full bg-white/10" />
                      <div className="pointer-events-none absolute -bottom-10 left-12 h-24 w-24 rounded-full bg-white/5" />
                      <div className="relative flex items-center justify-between text-xs text-white/80">
                        <span className="flex items-center gap-1.5 font-semibold"><Icon size={14} />{a.name}</span>
                        <span className="font-mono tracking-widest" dir="ltr">{a.code}</span>
                      </div>
                      <div className="relative mt-5 text-[1.35rem] font-black tracking-tight tabular-nums">{formatMoney(a.balance)}</div>
                      <div className="relative mt-1 text-[11px] text-white/70">
                        {total > 0 ? `${((a.balance / total) * 100).toFixed(1)}% من إجمالي الأرصدة` : '—'}
                        <span className="ms-2 font-bold text-white/90">· اضغط للتفاصيل</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
        <Card className="mt-4">
          <CardHeader title="طرق الدفع والخزائن" subtitle="أضف أورنج كاش أو أي محفظة/حساب · ثم حوّل بينها" icon={Wallet} />
          <div className="flex flex-wrap gap-2 p-4">
            {payMethods.map((m) => (
              <Badge key={m.id} tone="sky">{m.name}{m.cashAccount ? ` · ${formatMoney(m.cashAccount.balance)}` : ''}</Badge>
            ))}
          </div>
        </Card>
        </>
      )}

      {tab === 'detail' && selectedAccount && (
        <div className="space-y-4">
          <Card className="!p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-500">تفاصيل الخزنة / الحساب</div>
                <div className="mt-1 text-2xl font-black text-slate-900">{selectedAccount.name}</div>
                <div className="mt-1 font-mono text-xs font-bold text-brand-700" dir="ltr">{selectedAccount.code}</div>
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-slate-500">الرصيد الحالي</div>
                <div className="text-3xl font-black money-num text-emerald-700">{formatMoney(selectedAccount.balance)}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] font-bold text-emerald-700">وارد</div>
                <div className="text-lg font-black money-num text-emerald-900">{formatMoney(detailIn)}</div>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                <div className="text-[11px] font-bold text-rose-700">صادر</div>
                <div className="text-lg font-black money-num text-rose-900">{formatMoney(detailOut)}</div>
              </div>
              <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                <div className="text-[11px] font-bold text-sky-700">تحصيلات</div>
                <div className="text-lg font-black money-num text-sky-900">{detailReceipts.length}</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[11px] font-bold text-amber-700">تحويلات</div>
                <div className="text-lg font-black money-num text-amber-900">{detailTransfers.length}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setTxForm({ accountId: selectedAccount.id, direction: 'IN', amount: '', description: '', voucherKind: 'RECEIPT', receivedBy: '', deliveredBy: '' });
                  setTxOpen(true);
                }}
              >
                إذن استلام على هذه الخزنة
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setTxForm({ accountId: selectedAccount.id, direction: 'OUT', amount: '', description: '', voucherKind: 'PAYOUT', receivedBy: '', deliveredBy: '' });
                  setTxOpen(true);
                }}
              >
                إذن صرف من هذه الخزنة
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelectedAccountId(null); setTab('overview'); }}>رجوع للحسابات</Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="حركات الخزنة" subtitle={`${accountTxs.length} حركة`} icon={Wallet} />
            {accountTxs.length === 0 ? <Empty text="لا توجد حركات على هذه الخزنة" /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>التاريخ</Th><Th>النوع</Th><Th>البيان</Th><Th>المسلِّم / المستلِم</Th><Th>المبلغ</Th><Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {accountTxs.map((t) => (
                    <tr key={t.id} className={t.direction === 'IN' ? 'row-debit' : 'row-credit'}>
                      <Td className="whitespace-nowrap text-slate-500">{formatDate(t.createdAt)}</Td>
                      <Td><Badge tone={t.direction === 'IN' ? 'emerald' : 'rose'}>{VOUCHER_LABEL(t)}</Badge></Td>
                      <Td className="max-w-xs truncate">{t.description || '—'}</Td>
                      <Td className="text-xs text-slate-600">{t.deliveredBy || t.receivedBy || t.createdBy?.fullName || '—'}</Td>
                      <Td className={`font-extrabold ${t.direction === 'IN' ? 'text-emerald-700' : 'text-rose-600'}`}>{formatMoney(t.amount)}</Td>
                      <Td>
                        {(t.voucherKind === 'RECEIPT' || t.voucherKind === 'PAYOUT') && (
                          <button type="button" className="text-slate-400 hover:text-brand-700" onClick={() => setPrintTx(t)} title="طباعة">
                            <Printer size={14} />
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="التحصيلات المرتبطة" subtitle={`${detailReceipts.length}`} icon={ArrowDownLeft} />
              {detailReceipts.length === 0 ? <Empty text="لا تحصيلات" /> : (
                <Table>
                  <thead><tr><Th>الرقم</Th><Th>العميل</Th><Th>المبلغ</Th><Th>التاريخ</Th></tr></thead>
                  <tbody>
                    {detailReceipts.map((r) => (
                      <tr key={r.id}>
                        <Td className="font-mono text-xs" dir="ltr">{r.number}</Td>
                        <Td>{r.customer.name}</Td>
                        <Td className="font-extrabold text-emerald-700">{formatMoney(r.amount)}</Td>
                        <Td>{formatDate(r.receivedAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader title="السدادات المرتبطة" subtitle={`${detailPayments.length}`} icon={ArrowUpRight} />
              {detailPayments.length === 0 ? <Empty text="لا سدادات" /> : (
                <Table>
                  <thead><tr><Th>الرقم</Th><Th>المورد</Th><Th>المبلغ</Th><Th>التاريخ</Th></tr></thead>
                  <tbody>
                    {detailPayments.map((p) => (
                      <tr key={p.id}>
                        <Td className="font-mono text-xs" dir="ltr">{p.number}</Td>
                        <Td>{p.supplier.name}</Td>
                        <Td className="font-extrabold text-rose-600">{formatMoney(p.amount)}</Td>
                        <Td>{formatDate(p.paidAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="تحويلات هذه الخزنة" subtitle={`${detailTransfers.length}`} icon={ArrowLeftRight} />
            {detailTransfers.length === 0 ? <Empty text="لا تحويلات" /> : (
              <Table>
                <thead><tr><Th>الرقم</Th><Th>من</Th><Th>إلى</Th><Th>المبلغ</Th><Th>التاريخ</Th></tr></thead>
                <tbody>
                  {detailTransfers.map((row) => (
                    <tr key={row.id}>
                      <Td className="font-mono text-xs" dir="ltr">{row.number}</Td>
                      <Td className="text-rose-700">{row.fromAccount.name}</Td>
                      <Td className="text-emerald-700">{row.toAccount.name}</Td>
                      <Td className="font-extrabold">{formatMoney(row.amount)}</Td>
                      <Td>{formatDate(row.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 'transfers' && (
        <Card>
          <CardHeader
            title="تحويلات بين الخزائن / الحسابات"
            subtitle={`${totals.transfers} تحويل · ${formatMoney(amounts.transfers)}`}
            icon={ArrowLeftRight}
            actions={<Button onClick={() => setTransferOpen(true)}><Plus size={14} /> تحويل جديد</Button>}
          />
          {transfers.length === 0 ? <Empty text="لا توجد تحويلات" hint="حوّل من خزنة إلى أخرى مثل أورنج كاش ← خزنة رئيسية" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>الرقم</Th><Th>التاريخ</Th><Th>من</Th><Th>إلى</Th><Th>المبلغ</Th><Th>ملاحظة</Th><Th>بواسطة</Th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((row) => (
                  <tr key={row.id}>
                    <Td><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{row.number}</span></Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatDate(row.createdAt)}</Td>
                    <Td className="font-semibold text-rose-700">{row.fromAccount.name}</Td>
                    <Td className="font-semibold text-emerald-700">{row.toAccount.name}</Td>
                    <Td className="whitespace-nowrap font-extrabold text-slate-900">{formatMoney(row.amount)}</Td>
                    <Td className="max-w-xs truncate text-muted">{row.note || '—'}</Td>
                    <Td className="text-slate-600">{row.createdBy?.fullName || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager page={listPage} pages={pageCount(totals.transfers)} total={totals.transfers} from={pageFrom(totals.transfers)} to={pageTo(totals.transfers)} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
        </Card>
      )}

      {tab === 'receipts' && (
        <Card>
          <CardHeader title="سجل التحصيلات من العملاء" subtitle={`${totals.receipts} عملية · ${formatMoney(amounts.receipts)}`} icon={ArrowDownLeft} />
          {receipts.length === 0 ? <Empty /> : (
            <Table>
              <thead>
                <tr>
                  <Th>الرقم</Th><Th>العميل</Th><Th>الفاتورة</Th><Th>الحساب</Th>
                  <Th>طريقة الدفع</Th><Th>المبلغ</Th><Th>التاريخ</Th>
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.map((r) => (
                  <tr key={r.id} className="row-debit">
                    <Td><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{r.number}</span></Td>
                    <Td className="font-bold text-slate-900">{r.customer.name}</Td>
                    <Td><span className="font-mono text-xs text-slate-500" dir="ltr">{r.salesInvoice?.number || '—'}</span></Td>
                    <Td className="text-slate-600">{r.cashAccount?.name || 'عند التحصيل'}</Td>
                    <Td><Badge tone="sky">{methodName(r.paymentMethod)}</Badge></Td>
                    <Td className="whitespace-nowrap font-extrabold text-emerald-700">+ {formatMoney(r.amount)}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatDate(r.receivedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager page={listPage} pages={pageCount(totals.receipts)} total={totals.receipts} from={pageFrom(totals.receipts)} to={pageTo(totals.receipts)} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
        </Card>
      )}

      {tab === 'payments' && (
        <Card>
          <CardHeader title="سجل السداد للموردين" subtitle={`${totals.payments} عملية · ${formatMoney(amounts.payments)}`} icon={ArrowUpRight} />
          {payments.length === 0 ? <Empty /> : (
            <Table>
              <thead>
                <tr>
                  <Th>الرقم</Th><Th>المورد</Th><Th>الفاتورة</Th><Th>الحساب</Th>
                  <Th>طريقة الدفع</Th><Th>المبلغ</Th><Th>التاريخ</Th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((p) => (
                  <tr key={p.id} className="row-credit">
                    <Td><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{p.number}</span></Td>
                    <Td className="font-bold text-slate-900">{p.supplier.name}</Td>
                    <Td><span className="font-mono text-xs text-slate-500" dir="ltr">{p.purchaseInvoice?.number || '—'}</span></Td>
                    <Td className="text-slate-600">{p.cashAccount?.name || 'عند الصرف'}</Td>
                    <Td><Badge tone="sky">{methodName(p.paymentMethod)}</Badge></Td>
                    <Td className="whitespace-nowrap font-extrabold text-rose-600">− {formatMoney(p.amount)}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatDate(p.paidAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager page={listPage} pages={pageCount(totals.payments)} total={totals.payments} from={pageFrom(totals.payments)} to={pageTo(totals.payments)} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
        </Card>
      )}

      {tab === 'movements' && (
        <Card>
          <CardHeader title="أذون الاستلام والصرف" subtitle={`${totals.movements} إذن / حركة`} icon={ArrowLeftRight} />
          {txs.length === 0 ? <Empty /> : (
            <Table>
              <thead>
                <tr>
                  <Th>رقم الإذن</Th><Th>التاريخ</Th><Th>الحساب</Th><Th>البيان</Th><Th>المسلِّم / المستلِم</Th><Th>النوع</Th><Th>المبلغ</Th><Th className="no-print"></Th>
                </tr>
              </thead>
              <tbody>
                {filteredTxs.map((t) => (
                  <tr key={t.id} className={t.direction === 'IN' ? 'row-debit' : 'row-credit'}>
                    <Td className="font-mono text-xs font-bold text-brand-700" dir="ltr">{t.voucherNumber || t.reference || '—'}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatDate(t.createdAt)}</Td>
                    <Td className="font-semibold text-slate-700">{t.account.name}</Td>
                    <Td className="max-w-md truncate text-slate-600">{t.description}</Td>
                    <Td className="text-xs text-slate-600">
                      {t.deliveredBy || t.receivedBy ? (
                        <>
                          <div>سلّم: {t.deliveredBy || '—'}</div>
                          <div>استلم: {t.receivedBy || '—'}</div>
                        </>
                      ) : '—'}
                    </Td>
                    <Td>
                      <Badge tone={t.direction === 'IN' ? 'emerald' : 'rose'}>
                        {t.voucherKind === 'RECEIPT' ? 'إذن استلام' : t.voucherKind === 'PAYOUT' ? 'إذن صرف' : t.direction === 'IN' ? 'وارد' : 'صادر'}
                      </Badge>
                    </Td>
                    <Td className={`whitespace-nowrap font-extrabold ${t.direction === 'IN' ? 'text-emerald-700' : 'text-rose-600'}`}>{t.direction === 'IN' ? '+' : '−'} {formatMoney(t.amount)}</Td>
                    <Td className="no-print">
                      <Button variant="ghost" onClick={() => setPrintTx(t)}><Printer size={14} /> طباعة</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager page={listPage} pages={pageCount(totals.movements)} total={totals.movements} from={pageFrom(totals.movements)} to={pageTo(totals.movements)} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
        </Card>
      )}

      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} title="تحصيل من عميل" wide>
        <div className="space-y-3">
          <div>
            <Label>العميل</Label>
            <Select
              value={receiptForm.customerId}
              onChange={(e) => setReceiptForm({ ...receiptForm, customerId: e.target.value, salesInvoiceId: '', amount: '' })}
            >
              <option value="">اختر</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>

          {customerSummary && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${dueBox(customerSummary.openInvoices)}`}>
              <div className="font-bold">
                المستحق على العميل: {customerSummary.openInvoices.length > 0
                  ? <DueAmount date={oldestOpen(customerSummary.openInvoices)} remaining={customerSummary.balance} />
                  : formatMoney(customerSummary.balance)}
              </div>
              {customerSummary.openInvoices.filter((row) => row.remaining > 0.009).length > 0 && (
                <div className="mt-2 space-y-1">
                  {customerSummary.openInvoices.filter((row) => row.remaining > 0.009).map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-2 text-xs">
                      <span>{row.number}</span>
                      <DueAmount date={row.invoiceDate} remaining={row.remaining} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {customerSummary && customerSummary.openInvoices.length > 0 && (
            <div>
              <Label>ربط بفاتورة (اختياري — بدون اختيار يُوزَّع على الفواتير تلقائيًا)</Label>
              <Select
                value={receiptForm.salesInvoiceId}
                onChange={(e) => {
                  const inv = customerSummary.openInvoices.find((i) => i.id === e.target.value);
                  setReceiptForm({
                    ...receiptForm,
                    salesInvoiceId: e.target.value,
                    amount: inv ? inv.remaining : receiptForm.amount,
                  });
                }}
              >
                <option value="">بدون فاتورة محددة</option>
                {customerSummary.openInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} — متبقي {formatMoney(i.remaining)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label>طريقة الدفع</Label>
            <Select value={receiptForm.methodId} onChange={(e) => setReceiptForm({ ...receiptForm, methodId: e.target.value })}>
              <option value="">اختر</option>
              {payMethods.map((m) => <option key={m.id} value={m.id}>{m.name}{m.cashAccount ? ` (${formatMoney(m.cashAccount.balance)})` : ''}</option>)}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>المبلغ المحصّل</Label>
              <NumberInput value={receiptForm.amount} onValueChange={(v) => setReceiptForm({ ...receiptForm, amount: v })} />
            </div>
            <div><Label>رقم مرجعي (تحويل)</Label><Input value={receiptForm.referenceNo} onChange={(e) => setReceiptForm({ ...receiptForm, referenceNo: e.target.value })} /></div>
          </div>
          <div><Label>ملاحظة</Label><Input value={receiptForm.note} onChange={(e) => setReceiptForm({ ...receiptForm, note: e.target.value })} /></div>
          <Button className="w-full" onClick={saveReceipt}>تأكيد التحصيل</Button>
        </div>
      </Modal>

      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="سداد لمورد" wide>
        <div className="space-y-3">
          <div>
            <Label>المورد</Label>
            <Select
              value={paymentForm.supplierId}
              onChange={(e) => setPaymentForm({ ...paymentForm, supplierId: e.target.value, purchaseInvoiceId: '', amount: '' })}
            >
              <option value="">اختر</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>

          {supplierSummary && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${dueBox(supplierSummary.openInvoices)}`}>
              <div className="font-bold">
                المستحق للمورد: {supplierSummary.openInvoices.length > 0
                  ? <DueAmount date={oldestOpen(supplierSummary.openInvoices)} remaining={supplierSummary.balance} />
                  : formatMoney(supplierSummary.balance)}
              </div>
              {supplierSummary.openInvoices.filter((row) => row.remaining > 0.009).length > 0 && (
                <div className="mt-2 space-y-1">
                  {supplierSummary.openInvoices.filter((row) => row.remaining > 0.009).map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-2 text-xs">
                      <span>{row.number}</span>
                      <DueAmount date={row.invoiceDate} remaining={row.remaining} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {supplierSummary && (
            <div>
              <Label>ربط بفاتورة (اختياري)</Label>
              <Select
                value={paymentForm.purchaseInvoiceId}
                onChange={(e) => {
                  const inv = supplierSummary.openInvoices.find((i) => i.id === e.target.value);
                  setPaymentForm({
                    ...paymentForm,
                    purchaseInvoiceId: e.target.value,
                    amount: inv ? inv.remaining : paymentForm.amount,
                  });
                }}
              >
                <option value="">بدون فاتورة = دفعة مقدمة في الحساب</option>
                {supplierSummary.openInvoices.filter((i) => i.remaining > 0.009).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} — متبقي {formatMoney(i.remaining)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {supplierSummary && supplierSummary.balance < -0.009 && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-900">
              رصيد مقدم حالي عند المورد: {formatMoney(Math.abs(supplierSummary.balance))} — يُخصم من أي فاتورة شراء جديدة تلقائيًا
            </div>
          )}

          <div>
            <Label>طريقة الدفع</Label>
            <Select value={paymentForm.methodId} onChange={(e) => setPaymentForm({ ...paymentForm, methodId: e.target.value })}>
              <option value="">اختر</option>
              {payMethods.map((m) => <option key={m.id} value={m.id}>{m.name}{m.cashAccount ? ` (${formatMoney(m.cashAccount.balance)})` : ''}</option>)}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>المبلغ المسدَّد</Label>
              <NumberInput value={paymentForm.amount} onValueChange={(v) => setPaymentForm({ ...paymentForm, amount: v })} />
            </div>
            <div><Label>رقم مرجعي (تحويل)</Label><Input value={paymentForm.referenceNo} onChange={(e) => setPaymentForm({ ...paymentForm, referenceNo: e.target.value })} /></div>
          </div>
          <div><Label>ملاحظة</Label><Input value={paymentForm.note} onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })} /></div>
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
            بدون فاتورة = <b>دفعة مقدمة</b> تُفضَّل في حساب المورد وتُخصم تلقائيًا من فواتير الشراء التالية. إن وُجدت فواتير مفتوحة بدون ربط، يوزَّع السداد عليها أولًا والباقي يبقى مقدمًا.
          </p>
          <Button className="w-full" onClick={savePayment}>تأكيد السداد</Button>
        </div>
      </Modal>

      <Modal
        open={txOpen}
        onClose={() => setTxOpen(false)}
        title={txForm.voucherKind === 'PAYOUT' ? 'إذن صرف كاش' : txForm.voucherKind === 'RECEIPT' ? 'إذن استلام كاش' : 'حركة خزنة'}
      >
        <div className="space-y-3">
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            رقم الإذن يتولد تلقائيًا ويظهر في تبويب «أذون الصرف/الاستلام» داخل الخزنة.
          </p>
          <div>
            <Label>نوع الإذن</Label>
            <Select
              value={txForm.voucherKind}
              onChange={(e) => {
                const voucherKind = e.target.value as 'RECEIPT' | 'PAYOUT' | 'MANUAL';
                setTxForm({
                  ...txForm,
                  voucherKind,
                  direction: voucherKind === 'RECEIPT' ? 'IN' : voucherKind === 'PAYOUT' ? 'OUT' : txForm.direction,
                });
              }}
            >
              <option value="RECEIPT">إذن استلام (وارد كاش)</option>
              <option value="PAYOUT">إذن صرف (صادر كاش)</option>
              <option value="MANUAL">حركة يدوية</option>
            </Select>
          </div>
          <div>
            <Label>الحساب / الخزنة</Label>
            <Select value={txForm.accountId} onChange={(e) => setTxForm({ ...txForm, accountId: e.target.value })}>
              <option value="">اختر</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          {txForm.voucherKind === 'MANUAL' && (
            <div>
              <Label>الاتجاه</Label>
              <Select value={txForm.direction} onChange={(e) => setTxForm({ ...txForm, direction: e.target.value as 'IN' | 'OUT' })}>
                <option value="IN">وارد</option>
                <option value="OUT">صادر</option>
              </Select>
            </div>
          )}
          <div>
            <Label>المبلغ</Label>
            <NumberInput value={txForm.amount} onValueChange={(v) => setTxForm({ ...txForm, amount: v })} />
          </div>
          <div>
            <Label>البيان</Label>
            <Input
              value={txForm.description}
              onChange={(e) => setTxForm({ ...txForm, description: e.target.value })}
              placeholder={txForm.voucherKind === 'PAYOUT' ? 'سبب الصرف' : 'سبب الاستلام'}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>اسم المُسلِّم</Label>
              <Input value={txForm.deliveredBy} onChange={(e) => setTxForm({ ...txForm, deliveredBy: e.target.value })} placeholder="مين اللي سلّم" />
            </div>
            <div>
              <Label>اسم المُستلِم</Label>
              <Input value={txForm.receivedBy} onChange={(e) => setTxForm({ ...txForm, receivedBy: e.target.value })} placeholder="مين اللي استلم" />
            </div>
          </div>
          <Button className="w-full" onClick={saveTx}>
            {txForm.voucherKind === 'PAYOUT' ? 'تأكيد إذن الصرف' : txForm.voucherKind === 'RECEIPT' ? 'تأكيد إذن الاستلام' : 'حفظ'}
          </Button>
        </div>
      </Modal>

      <Modal open={!!printTx} onClose={() => setPrintTx(null)} title={printTx ? `${VOUCHER_LABEL(printTx)} ${printTx.voucherNumber || ''}` : ''} wide>
        {printTx && (
          <div>
            <div className="mb-4 flex justify-end no-print">
              <Button onClick={() => window.print()}><Printer size={16} /> طباعة / PDF</Button>
            </div>
            <PrintHeader title={`${VOUCHER_LABEL(printTx)} رقم ${printTx.voucherNumber || printTx.reference || ''}`} subtitle={formatDate(printTx.createdAt)} />
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {([
                ['رقم الإذن', printTx.voucherNumber || printTx.reference || '—'],
                ['التاريخ', formatDate(printTx.createdAt)],
                ['الخزنة / الحساب', printTx.account.name],
                ['المبلغ', formatMoney(printTx.amount)],
                ['المُسلِّم', printTx.deliveredBy],
                ['المُستلِم', printTx.receivedBy],
              ] as [string, string | null | undefined][]).map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 px-3 py-2.5">
                  <div className="text-[11px] font-bold text-slate-500">{label}</div>
                  <div className="mt-1 min-h-[1.5rem] font-bold text-slate-900">
                    {value || <span className="inline-block h-5 w-full border-b border-dotted border-slate-500" />}
                  </div>
                </div>
              ))}
              <div className="rounded-xl border border-slate-200 px-3 py-2.5 sm:col-span-2">
                <div className="text-[11px] font-bold text-slate-500">البيان</div>
                <div className="mt-1 font-bold text-slate-900">{printTx.description}</div>
              </div>
            </div>
            <div className="mt-12 grid grid-cols-2 gap-8 text-center text-sm">
              {([
                ['توقيع المُسلِّم', printTx.deliveredBy],
                ['توقيع المُستلِم', printTx.receivedBy],
              ] as [string, string | null | undefined][]).map(([label, name]) => (
                <div key={label} className="rounded-xl border-2 border-dashed border-slate-400 p-4">
                  <div className="mb-2 text-xs font-bold text-slate-500">{label}</div>
                  <div className="mx-auto mb-3 h-16 w-full max-w-[14rem] border-b-2 border-slate-500" />
                  <div className="font-extrabold text-slate-900">
                    {name || <span className="inline-block h-5 w-40 border-b border-dotted border-slate-500" />}
                  </div>
                  <div className="mt-1 text-xs text-muted">الاسم</div>
                </div>
              ))}
            </div>
            {printTx.createdBy?.fullName && (
              <div className="mt-6 text-xs text-muted">حُرِّر بواسطة: {printTx.createdBy.fullName}</div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="تحويل بين خزائن / حسابات">
        <div className="space-y-3">
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
            اختر الحساب <b>من</b> و <b>إلى</b> والمبلغ — الرصيد يتحدث فورًا ويُسجَّل في تفاصيل التحويلات.
          </p>
          <div>
            <Label>من</Label>
            <Select value={transferForm.fromAccountId} onChange={(e) => setTransferForm({ ...transferForm, fromAccountId: e.target.value })}>
              <option value="">اختر المصدر</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {formatMoney(a.balance)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>إلى</Label>
            <Select value={transferForm.toAccountId} onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })}>
              <option value="">اختر الوجهة</option>
              {accounts.filter((a) => a.id !== transferForm.fromAccountId).map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {formatMoney(a.balance)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>المبلغ</Label>
            <NumberInput value={transferForm.amount} onValueChange={(v) => setTransferForm({ ...transferForm, amount: v })} />
          </div>
          <div>
            <Label>ملاحظة / سبب التحويل</Label>
            <Input value={transferForm.note} onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })} placeholder="اختياري" />
          </div>
          <Button className="w-full" onClick={saveTransfer}>تنفيذ التحويل</Button>
        </div>
      </Modal>

      <Modal open={accOpen} onClose={() => setAccOpen(false)} title="خزنة / طريقة دفع جديدة">
        <div className="space-y-3" data-nav-root="">
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            أضف خزنة أو محفظة — الكود يتولّد تلقائيًا من النظام.
          </p>
          <div>
            <Label>نوع الحساب</Label>
            <Select value={accForm.accountType} onChange={(e) => setAccForm({ ...accForm, accountType: e.target.value, kind: 'IMMEDIATE' })}>
              <option value="CASH">خزنة نقدية</option>
              <option value="WALLET">محفظة إلكترونية</option>
              <option value="BANK">حساب بنكي</option>
            </Select>
          </div>
          <div><Label>الاسم</Label><Input value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} placeholder="خزنة مصروفات / أورنج كاش" /></div>
          <div>
            <Label>رصيد افتتاحي</Label>
            <NumberInput value={accForm.balance} onValueChange={(v) => setAccForm({ ...accForm, balance: v })} />
          </div>
          <Button className="w-full" onClick={saveAccount}>حفظ</Button>
        </div>
      </Modal>
    </div>
  );
}
