import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PackageCheck, Plus, Printer, Trash2 } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { useAccess } from '../lib/auth';
import { useConfirm, useToast } from '../lib/feedback';
import { optionalNumber } from '../lib/size';
import { DualPrintCopies } from '../components/DualPrintCopies';
import {
  Button, Card, Empty, Field, Input, Modal, NumberInput, PageHeader, Pager, PrintHeader, SearchBox, Select, Table, Td, Th, todayIso,
} from '../components/ui';

type Customer = { id: string; code: string; name: string };
type InvoiceOption = { id: string; number: string; customer: { name: string } };
type NoteLine = { id: string; description: string; quantity?: number | null; weight?: number | null };
type DeliveryNote = {
  id: string;
  number: string;
  noteDate: string;
  recipientName: string;
  deliveredBy?: string | null;
  notes?: string | null;
  customer?: { id: string; name: string; phone?: string | null; address?: string | null } | null;
  salesInvoice?: { id: string; number: string } | null;
  lines: NoteLine[];
};
type LineForm = { description: string; quantity: number | ''; weight: number | '' };

const emptyLine = (): LineForm => ({ description: '', quantity: '', weight: '' });
const emptyForm = () => ({
  salesInvoiceId: '',
  customerId: '',
  recipientName: '',
  noteDate: todayIso(),
  deliveredBy: '',
  notes: '',
  lines: [emptyLine()],
});

function total(lines: { quantity?: number | null; weight?: number | null }[], key: 'quantity' | 'weight') {
  return lines.reduce((sum, line) => sum + (Number(line[key]) || 0), 0);
}

function fmt(value: number) {
  return Number.isInteger(value) ? value.toLocaleString('ar-EG') : value.toLocaleString('ar-EG', { maximumFractionDigits: 3 });
}

export function DeliveryNotesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAccess();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<DeliveryNote[]>([]);
  const [total_, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [printNote, setPrintNote] = useState<DeliveryNote | null>(null);

  async function load() {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) query.set('q', search.trim());
    const res = await api<{ items: DeliveryNote[]; total: number }>(`/documents/delivery-notes?${query}`);
    setRows(res.items);
    setTotal(res.total);
  }

  useEffect(() => { setPage(1); }, [search, pageSize]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load().catch(() => undefined); }, 200);
    return () => window.clearTimeout(timer);
  }, [page, pageSize, search]);

  async function loadPickers() {
    const [cust, inv] = await Promise.all([
      api<Customer[]>('/customers').catch(() => []),
      api<{ items: InvoiceOption[] }>('/sales?page=1&pageSize=100').then((res) => res.items).catch(() => []),
    ]);
    setCustomers(cust);
    setInvoices(inv);
  }

  async function fillFromInvoice(invoiceId: string) {
    if (!invoiceId) {
      setForm((current) => ({ ...current, salesInvoiceId: '' }));
      return;
    }
    try {
      const draft = await api<{ salesInvoiceId: string; customerId: string; recipientName: string; lines: { description: string; quantity: number; weight?: number | null }[] }>(
        `/documents/delivery-notes/from-invoice/${invoiceId}`,
      );
      setForm((current) => ({
        ...current,
        salesInvoiceId: draft.salesInvoiceId,
        customerId: draft.customerId,
        recipientName: draft.recipientName,
        lines: draft.lines.length
          ? draft.lines.map((line) => ({ description: line.description, quantity: line.quantity ?? '', weight: line.weight ?? '' }))
          : [emptyLine()],
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر قراءة الفاتورة');
    }
  }

  async function openNew(invoiceId?: string) {
    setForm(emptyForm());
    setOpen(true);
    await loadPickers();
    if (invoiceId) await fillFromInvoice(invoiceId);
  }

  useEffect(() => {
    const invoiceId = params.get('invoice');
    if (!invoiceId) return;
    const next = new URLSearchParams(params);
    next.delete('invoice');
    setParams(next, { replace: true });
    openNew(invoiceId).catch(() => undefined);
  }, []);

  function setLine(index: number, patch: Partial<LineForm>) {
    setForm((current) => ({ ...current, lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) }));
  }

  async function save() {
    if (!form.recipientName.trim()) return toast.error('اكتب اسم المستلم');
    const lines = form.lines.filter((line) => line.description.trim());
    if (!lines.length) return toast.error('اكتب بيان بند واحد على الأقل');
    setBusy(true);
    try {
      const created = await api<DeliveryNote>('/documents/delivery-notes', {
        method: 'POST',
        body: JSON.stringify({
          recipientName: form.recipientName.trim(),
          customerId: form.customerId || undefined,
          salesInvoiceId: form.salesInvoiceId || undefined,
          noteDate: form.noteDate || undefined,
          deliveredBy: form.deliveredBy.trim() || undefined,
          notes: form.notes.trim() || undefined,
          lines: lines.map((line) => ({
            description: line.description.trim(),
            quantity: optionalNumber(line.quantity),
            weight: optionalNumber(line.weight),
          })),
        }),
      });
      toast.success(`تم حفظ إذن التسليم ${created.number}`);
      setOpen(false);
      setPrintNote(created);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: DeliveryNote) {
    const ok = await confirm({ title: 'حذف إذن التسليم', message: `حذف ${row.number}؟`, confirmLabel: 'حذف', danger: true });
    if (!ok) return;
    try {
      await api(`/documents/delivery-notes/${row.id}`, { method: 'DELETE' });
      toast.success('تم الحذف');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحذف');
    }
  }

  const pages = Math.max(1, Math.ceil(total_ / pageSize));
  const from = total_ === 0 ? 0 : (Math.min(page, pages) - 1) * pageSize + 1;
  const to = Math.min(Math.min(page, pages) * pageSize, total_);

  return (
    <div>
      <PageHeader
        title="إذن تسليم بضاعة"
        subtitle="تم تسليم السيد · البيان · العدد · الوزن · توقيع المستلم والمسلِّم — يتملّى من فاتورة البيع لو عايز"
        icon={PackageCheck}
        actions={can('documents', 'create') ? <Button onClick={() => openNew()}><Plus size={16} /> إذن تسليم جديد</Button> : undefined}
      />

      <Card>
        <div className="mb-3">
          <SearchBox value={search} onChange={setSearch} placeholder="بحث برقم الإذن أو المستلم أو العميل أو رقم الفاتورة" className="!w-96 max-w-full" />
        </div>
        {rows.length === 0 ? <Empty text="لا أذون تسليم بعد" hint="أنشئ إذن تسليم جديد أو افتحه من فاتورة بيع" /> : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>رقم الإذن</Th>
                  <Th>التاريخ</Th>
                  <Th>تم تسليم السيد</Th>
                  <Th>البنود</Th>
                  <Th>العدد</Th>
                  <Th>الوزن</Th>
                  <Th>الفاتورة</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Td className="font-mono text-xs font-bold text-brand-700"><span dir="ltr">{row.number}</span></Td>
                    <Td className="whitespace-nowrap text-slate-600">{formatDate(row.noteDate)}</Td>
                    <Td className="font-bold">{row.recipientName}</Td>
                    <Td className="max-w-xs truncate text-sm text-slate-600">{row.lines.map((line) => line.description).join(' · ')}</Td>
                    <Td className="tabular-nums">{fmt(total(row.lines, 'quantity'))}</Td>
                    <Td className="tabular-nums">{fmt(total(row.lines, 'weight'))}</Td>
                    <Td className="font-mono text-xs"><span dir="ltr">{row.salesInvoice?.number || '—'}</span></Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button variant="ghost" onClick={() => setPrintNote(row)}><Printer size={14} /> طباعة</Button>
                        {can('documents', 'delete') && (
                          <button type="button" title="حذف" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => remove(row)}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pages={pages} total={total_} from={from} to={to} pageSize={pageSize} onPageSize={setPageSize} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="إذن تسليم بضاعة جديد" wide>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="من فاتورة بيع (اختياري — يملّى البيانات)">
              <Select value={form.salesInvoiceId} onChange={(e) => fillFromInvoice(e.target.value)}>
                <option value="">بدون فاتورة</option>
                {invoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.number} — {inv.customer.name}</option>)}
              </Select>
            </Field>
            <Field label="العميل (اختياري)">
              <Select
                value={form.customerId}
                onChange={(e) => {
                  const customer = customers.find((c) => c.id === e.target.value);
                  setForm({ ...form, customerId: e.target.value, recipientName: form.recipientName || customer?.name || '' });
                }}
              >
                <option value="">بدون</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="تم تسليم السيد">
              <Input value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} placeholder="اسم المستلم" />
            </Field>
            <Field label="التاريخ">
              <Input type="date" value={form.noteDate} onChange={(e) => setForm({ ...form, noteDate: e.target.value })} />
            </Field>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[1fr_7rem_7rem_2.25rem] gap-2 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
              <span>البيان</span><span>العدد</span><span>الوزن</span><span />
            </div>
            {form.lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_7rem_7rem_2.25rem] items-center gap-2 border-t border-slate-100 px-3 py-2">
                <Input value={line.description} onChange={(e) => setLine(index, { description: e.target.value })} placeholder="البيان" />
                <NumberInput value={line.quantity} onValueChange={(quantity) => setLine(index, { quantity })} placeholder="العدد" />
                <NumberInput value={line.weight} onValueChange={(weight) => setLine(index, { weight })} placeholder="الوزن" />
                <button
                  type="button"
                  title="حذف البند"
                  disabled={form.lines.length === 1}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                  onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) })}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}><Plus size={14} /> بند</Button>
              <span className="font-bold text-slate-700">
                إجمالي العدد {fmt(total(form.lines.map((l) => ({ quantity: Number(l.quantity) || 0 })), 'quantity'))}
                {' · '}
                إجمالي الوزن {fmt(total(form.lines.map((l) => ({ weight: Number(l.weight) || 0 })), 'weight'))}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ملحوظة">
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <Field label="اسم المُسلِّم">
              <Input value={form.deliveredBy} onChange={(e) => setForm({ ...form, deliveredBy: e.target.value })} placeholder="مين اللي سلّم البضاعة" />
            </Field>
          </div>
          <Button className="w-full" disabled={busy} onClick={save}><Printer size={16} /> حفظ وطباعة</Button>
        </div>
      </Modal>

      <Modal open={!!printNote} onClose={() => setPrintNote(null)} title={`إذن تسليم ${printNote?.number || ''}`} wide>
        {printNote && (
          <div>
            <div className="mb-4 flex justify-end no-print">
              <Button onClick={() => window.print()}><Printer size={16} /> طباعة / PDF</Button>
            </div>
            <DualPrintCopies dense={printNote.lines.length > 6}>
              <PrintHeader title={`إذن تسليم بضاعة رقم ${printNote.number}`} subtitle={formatDate(printNote.noteDate)} />
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <div>
                  تم تسليم السيد / <b className="text-base">{printNote.recipientName}</b> البضاعة الآتية:
                </div>
                {printNote.salesInvoice && <div className="text-slate-600">فاتورة رقم: <b dir="ltr">{printNote.salesInvoice.number}</b></div>}
              </div>
              <Table>
                <thead>
                  <tr><Th>م</Th><Th>البيان</Th><Th>العدد</Th><Th>الوزن</Th></tr>
                </thead>
                <tbody>
                  {printNote.lines.map((line, index) => (
                    <tr key={line.id}>
                      <Td>{index + 1}</Td>
                      <Td className="font-bold">{line.description}</Td>
                      <Td className="tabular-nums">{line.quantity != null ? fmt(line.quantity) : '—'}</Td>
                      <Td className="tabular-nums">{line.weight != null ? fmt(line.weight) : '—'}</Td>
                    </tr>
                  ))}
                  <tr className="font-extrabold">
                    <Td />
                    <Td>الإجمالي</Td>
                    <Td className="tabular-nums">{fmt(total(printNote.lines, 'quantity'))}</Td>
                    <Td className="tabular-nums">{fmt(total(printNote.lines, 'weight'))}</Td>
                  </tr>
                </tbody>
              </Table>
              <div className="mt-2 text-sm">
                ملحوظة: {printNote.notes || <span className="inline-block h-4 w-2/3 border-b border-dotted border-slate-500 align-bottom" />}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-6 text-center text-sm">
                {([
                  ['توقيع المُستلِم', printNote.recipientName],
                  ['توقيع المُسلِّم', printNote.deliveredBy],
                ] as [string, string | null | undefined][]).map(([label, name]) => (
                  <div key={label}>
                    <div className="mb-8 text-xs font-bold text-slate-600">{label}</div>
                    <div className="border-t border-slate-500 pt-1 font-bold">
                      {name || <span className="inline-block h-4 w-32 border-b border-dotted border-slate-500" />}
                    </div>
                  </div>
                ))}
              </div>
            </DualPrintCopies>
          </div>
        )}
      </Modal>
    </div>
  );
}
