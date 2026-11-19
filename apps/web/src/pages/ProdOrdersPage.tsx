import { useEffect, useState } from 'react';
import { ClipboardPlus, Plus, Printer, Trash2 } from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { useToast } from '../lib/feedback';
import { optionalNumber, sizeText } from '../lib/size';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  Input,
  Modal,
  NumberInput,
  PageHeader,
  PageSkeleton,
  PrintHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui';

type Customer = { id: string; name: string; code: string; phone?: string | null; address?: string | null };
type Product = { id: string; name: string; sku: string; width?: number | null; thickness?: number | null };
type ProdOrderLine = {
  id: string;
  description: string;
  width?: number | null;
  thickness?: number | null;
  quantity: number;
  unitPrice: number;
  product?: { id: string; name: string; sku: string; unit?: string } | null;
};
type ProdOrder = {
  id: string;
  number: string;
  description: string;
  quantity: number;
  unitPrice: number;
  orderDate: string;
  deliveryDate?: string | null;
  notes?: string | null;
  status: string;
  customer: Customer;
  product?: Product | null;
  lines: ProdOrderLine[];
};

type LineForm = {
  productId: string;
  description: string;
  width: number | '';
  thickness: number | '';
  quantity: number | '';
  unitPrice: number | '';
};

const STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  CONFIRMED: 'مؤكد',
  IN_PRODUCTION: 'قيد التصنيع',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغى',
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): LineForm => ({ productId: '', description: '', width: '', thickness: '', quantity: '', unitPrice: '' });
const emptyForm = () => ({ customerId: '', orderDate: today(), deliveryDate: '', notes: '', lines: [emptyLine()] });

function orderLines(order: ProdOrder): ProdOrderLine[] {
  if (order.lines?.length) return order.lines;
  return [{ id: order.id, description: order.description, quantity: order.quantity, unitPrice: order.unitPrice, product: order.product }];
}

export function ProdOrdersPage() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ProdOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [printOrder, setPrintOrder] = useState<ProdOrder | null>(null);

  async function load() {
    setError('');
    try {
      const [list, cust, prod] = await Promise.all([
        api<ProdOrder[]>('/production/prod-orders'),
        api<Customer[]>('/customers'),
        api<Product[]>('/products'),
      ]);
      setRows(list);
      setCustomers(cust);
      setProducts(prod);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر التحميل');
      setLoaded(true);
    }
  }

  useEffect(() => { load().catch(() => undefined); }, []);

  function setLine(index: number, patch: Partial<LineForm>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  function pickProduct(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    const line = form.lines[index];
    setLine(index, {
      productId,
      description: line.description || product?.name || '',
      width: line.width === '' && product?.width != null ? product.width : line.width,
      thickness: line.thickness === '' && product?.thickness != null ? product.thickness : line.thickness,
    });
  }

  async function save() {
    if (!form.customerId) return toast.error('اختر العميل');
    const lines = form.lines.filter((line) => line.description.trim() || line.quantity !== '');
    if (!lines.length) return toast.error('أضف بند واحد على الأقل');
    for (const [index, line] of lines.entries()) {
      if (!line.description.trim()) return toast.error(`اكتب بيان البند ${index + 1}`);
      if (!(Number(line.quantity) > 0)) return toast.error(`أدخل كمية البند ${index + 1}`);
    }
    setBusy(true);
    try {
      const created = await api<ProdOrder>('/production/prod-orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.customerId,
          orderDate: form.orderDate || undefined,
          deliveryDate: form.deliveryDate || undefined,
          notes: form.notes.trim() || undefined,
          lines: lines.map((line) => ({
            productId: line.productId || undefined,
            description: line.description.trim(),
            width: optionalNumber(line.width),
            thickness: optionalNumber(line.thickness),
            quantity: Number(line.quantity),
            unitPrice: line.unitPrice === '' ? 0 : Number(line.unitPrice),
          })),
        }),
      });
      toast.success('تم حفظ أمر الإنتاج');
      setOpen(false);
      setForm(emptyForm());
      setPrintOrder(created);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/production/prod-orders/${id}`, { method: 'DELETE' });
      toast.success('تم الحذف');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحذف');
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      await api(`/production/prod-orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التحديث');
    }
  }

  if (!loaded) return <PageSkeleton />;
  if (error) return <ErrorState text={error} onRetry={() => load()} />;

  const printLines = printOrder ? orderLines(printOrder) : [];
  const printTotal = printLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

  return (
    <div>
      <PageHeader
        title="أمر إنتاج"
        subtitle="طلب تشغيل من العميل: أصناف متعددة بالمقاس والكمية · تاريخ الطلب والاستلام · طباعة"
        actions={
          <Button onClick={() => { setForm(emptyForm()); setOpen(true); }}>
            <Plus size={16} /> أمر جديد
          </Button>
        }
      />

      <Card>
        {rows.length === 0 ? (
          <Empty text="لا أوامر بعد" hint="أنشئ أمر إنتاج باختيار العميل وإضافة الأصناف" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th>
                <Th>العميل</Th>
                <Th>البنود</Th>
                <Th>إجمالي الكمية</Th>
                <Th>تاريخ الطلب</Th>
                <Th>تاريخ الاستلام</Th>
                <Th>الحالة</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td className="font-mono text-xs font-bold"><span dir="ltr">{row.number}</span></Td>
                  <Td className="font-bold">{row.customer.name}</Td>
                  <Td>
                    <div className="space-y-0.5">
                      {orderLines(row).map((line) => (
                        <div key={line.id} className="text-sm">
                          <span className="font-semibold">{line.description}</span>
                          {sizeText(line.width, line.thickness) && <span className="text-xs text-muted"> · {sizeText(line.width, line.thickness)}</span>}
                          <span className="text-xs text-muted"> · {line.quantity}</span>
                        </div>
                      ))}
                    </div>
                    {row.notes && <div className="mt-1 text-xs text-muted">{row.notes}</div>}
                  </Td>
                  <Td>{row.quantity}</Td>
                  <Td>{formatDate(row.orderDate)}</Td>
                  <Td>{row.deliveryDate ? formatDate(row.deliveryDate) : '—'}</Td>
                  <Td>
                    <Select
                      value={row.status}
                      onChange={(e) => setStatus(row.id, e.target.value)}
                      className="h-9 min-w-[140px]"
                    >
                      {Object.entries(STATUS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="طباعة"
                        className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-brand-50 hover:text-brand-700"
                        onClick={() => setPrintOrder(row)}
                      >
                        <Printer size={15} />
                      </button>
                      <button
                        type="button"
                        title="حذف"
                        className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        onClick={() => remove(row.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="أمر إنتاج جديد" wide>
        <div className="space-y-3" data-nav-root="">
          <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
            <ClipboardPlus size={16} />
            أضف أكثر من صنف بعلامة + — العرض والسمك اختياريين وبالسنتيمتر · تنقل بالأسهم ↓↑
          </div>
          <Field label="العميل">
            <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">اختر العميل</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.code ? ` · ${c.code}` : ''}</option>
              ))}
            </Select>
          </Field>

          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-extrabold text-slate-800">البنود</div>
              <Button type="button" variant="secondary" onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}>
                <Plus size={14} /> إضافة صنف
              </Button>
            </div>
            {form.lines.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-12">
                <div className="sm:col-span-3">
                  <Select value={line.productId} onChange={(e) => pickProduct(index, e.target.value)}>
                    <option value="">صنف (اختياري)</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-3">
                  <Input value={line.description} onChange={(e) => setLine(index, { description: e.target.value })} placeholder="البيان" />
                </div>
                <div className="sm:col-span-1">
                  <NumberInput value={line.width} onValueChange={(width) => setLine(index, { width })} placeholder="العرض" />
                </div>
                <div className="sm:col-span-1">
                  <NumberInput value={line.thickness} onValueChange={(thickness) => setLine(index, { thickness })} placeholder="السمك" />
                </div>
                <div className="sm:col-span-2">
                  <NumberInput value={line.quantity} onValueChange={(quantity) => setLine(index, { quantity })} placeholder="الكمية" />
                </div>
                <div className="sm:col-span-1">
                  <NumberInput value={line.unitPrice} onValueChange={(unitPrice) => setLine(index, { unitPrice })} placeholder="السعر" />
                </div>
                <div className="flex items-center justify-center sm:col-span-1">
                  <button
                    type="button"
                    title="حذف البند"
                    disabled={form.lines.length === 1}
                    className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                    onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) })}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="تاريخ الطلب">
              <Input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} />
            </Field>
            <Field label="تاريخ الاستلام">
              <Input type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
            </Field>
          </div>
          <Field label="ملاحظات">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <Button className="w-full" disabled={busy} onClick={save}>
            <Printer size={16} /> حفظ وطباعة
          </Button>
        </div>
      </Modal>

      <Modal open={!!printOrder} onClose={() => setPrintOrder(null)} title={`أمر إنتاج ${printOrder?.number || ''}`} wide>
        {printOrder && (
          <div>
            <div className="mb-4 flex justify-end no-print">
              <Button onClick={() => window.print()}><Printer size={16} /> طباعة / PDF</Button>
            </div>
            <PrintHeader title={`أمر إنتاج رقم ${printOrder.number}`} subtitle={STATUS[printOrder.status] || printOrder.status} />
            <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>العميل: <b>{printOrder.customer.name}</b></div>
              <div>الهاتف: <b>{printOrder.customer.phone || '—'}</b></div>
              <div>تاريخ الطلب: <b>{formatDate(printOrder.orderDate)}</b></div>
              <div>تاريخ الاستلام: <b>{printOrder.deliveryDate ? formatDate(printOrder.deliveryDate) : '—'}</b></div>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>م</Th>
                  <Th>البيان</Th>
                  <Th>العرض (سم)</Th>
                  <Th>السمك (سم)</Th>
                  <Th>الكمية</Th>
                  <Th>السعر</Th>
                  <Th>الإجمالي</Th>
                </tr>
              </thead>
              <tbody>
                {printLines.map((line, index) => (
                  <tr key={line.id}>
                    <Td>{index + 1}</Td>
                    <Td className="font-bold">
                      {line.description}
                      {line.product && line.product.name !== line.description && (
                        <div className="text-xs font-normal text-muted">{line.product.name}</div>
                      )}
                    </Td>
                    <Td>{line.width ?? '—'}</Td>
                    <Td>{line.thickness ?? '—'}</Td>
                    <Td className="tabular-nums">{line.quantity}</Td>
                    <Td className="tabular-nums">{line.unitPrice ? formatMoney(line.unitPrice) : '—'}</Td>
                    <Td className="tabular-nums font-bold">{line.unitPrice ? formatMoney(line.quantity * line.unitPrice) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
              <div>إجمالي الكمية: <b>{printLines.reduce((sum, line) => sum + line.quantity, 0)}</b></div>
              {printTotal > 0 && <Badge tone="brand">الإجمالي: {formatMoney(printTotal)}</Badge>}
            </div>
            {printOrder.notes && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">ملاحظات: {printOrder.notes}</div>}
            <div className="mt-12 grid grid-cols-2 gap-8 text-center text-sm font-bold text-slate-700">
              {['توقيع العميل', 'توقيع المسؤول'].map((role) => (
                <div key={role}>
                  <div className="mb-10">{role}</div>
                  <div className="border-t border-slate-400 pt-1 text-xs font-semibold text-slate-500">الاسم / التوقيع</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
