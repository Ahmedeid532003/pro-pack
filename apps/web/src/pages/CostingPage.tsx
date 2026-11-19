import { useMemo, useState, type ReactNode } from 'react';
import { Calculator, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { formatMoney } from '../lib/api';
import { Button, Card, Field, Input, NumberInput, PageHeader } from '../components/ui';

/** تكاليف تشغيلية تُحسب تلقائياً من سعر للكيلو × إجمالي الوزن */
const RATE_COST_FIELDS = [
  { key: 'printing', label: 'طباعة' },
  { key: 'lamination', label: 'تبطين' },
  { key: 'slitter', label: 'سليدر' },
  { key: 'detailing', label: 'تفصيل' },
  { key: 'glue', label: 'صمغ' },
] as const;

type RateKey = (typeof RATE_COST_FIELDS)[number]['key'];
type WasteMode = 'pct' | 'kg';

type CustomRate = { id: number; label: string; rate: number | '' };
type MaterialLine = { id: number; name: string; weight: number | ''; pricePerKg: number | '' };

type FormState = {
  materials: MaterialLine[];
  rates: Record<RateKey, number | ''>;
  customRates: CustomRate[];
  wasteMode: WasteMode;
  wasteValue: number | '';
  expenses: number | '';
  profitPct: number | '';
};

const emptyRates = (): Record<RateKey, number | ''> =>
  Object.fromEntries(RATE_COST_FIELDS.map((f) => [f.key, '' as number | ''])) as Record<RateKey, number | ''>;

function emptyMaterial(): MaterialLine {
  return { id: Date.now() + Math.random(), name: '', weight: '', pricePerKg: '' };
}

function n(v: number | '') {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtQty(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
}

function CostRow({
  label,
  rate,
  onRate,
  weight,
  amount,
  onRemove,
}: {
  label: ReactNode;
  rate: number | '';
  onRate: (rate: number | '') => void;
  weight: number;
  amount: number;
  onRemove?: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_7rem_6rem_8rem_2rem] items-center gap-2 border-t border-slate-100 px-3 py-2">
      <div className="min-w-0">{label}</div>
      <NumberInput value={rate} onValueChange={onRate} placeholder="0" />
      <span className="text-center text-xs font-semibold text-slate-500 tabular-nums">
        × {weight > 0 ? `${fmtQty(weight)} كجم` : '—'}
      </span>
      <span className={`text-left font-black money-num ${amount > 0 ? 'text-slate-900' : 'text-slate-300'}`} dir="ltr">
        {formatMoney(amount)}
      </span>
      {onRemove ? (
        <button type="button" title="حذف البند" onClick={onRemove} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <Trash2 size={14} />
        </button>
      ) : <span />}
    </div>
  );
}

export function CostingPage() {
  const [form, setForm] = useState<FormState>({
    materials: [emptyMaterial()],
    rates: emptyRates(),
    customRates: [],
    wasteMode: 'pct',
    wasteValue: '',
    expenses: '',
    profitPct: '',
  });

  const calc = useMemo(() => {
    const materialLines = form.materials.map((m) => {
      const weight = n(m.weight);
      const pricePerKg = n(m.pricePerKg);
      const amount = weight * pricePerKg;
      return {
        ...m,
        weight,
        pricePerKg,
        amount,
        label: m.name.trim() || 'خامة',
      };
    });
    const weight = materialLines.reduce((s, m) => s + m.weight, 0);
    const material = materialLines.reduce((s, m) => s + m.amount, 0);
    const avgPricePerKg = weight > 0 ? material / weight : 0;

    const describe = (label: string, rate: number, amount: number) =>
      rate > 0 && weight > 0
        ? `${fmtQty(rate)} ج/كجم × ${fmtQty(weight)} كجم = ${formatMoney(amount)}`
        : rate > 0
          ? `أدخل أوزان الخامات لحساب ${label}`
          : '';
    const rateLines = [
      ...RATE_COST_FIELDS.map((f) => ({ key: f.key as string, label: f.label, rate: n(form.rates[f.key]) })),
      ...form.customRates.map((c) => ({ key: `custom-${c.id}`, label: c.label.trim() || 'بند إضافي', rate: n(c.rate) })),
    ].map((line) => {
      const amount = line.rate * weight;
      return { ...line, amount, detail: describe(line.label, line.rate, amount) };
    });
    const ratesTotal = rateLines.reduce((s, c) => s + c.amount, 0);

    const wasteValue = n(form.wasteValue);
    let wasteAmount = 0;
    let wasteDetail = '';
    let wasteLabel = 'هالك';
    if (form.wasteMode === 'pct') {
      wasteAmount = material * (wasteValue / 100);
      wasteLabel = `هالك ${fmtQty(wasteValue)}%`;
      if (wasteValue > 0 && material > 0) {
        wasteDetail = `${fmtQty(wasteValue)}% من تكلفة الخامات ${formatMoney(material)} = ${formatMoney(wasteAmount)}`;
      } else if (wasteValue > 0) {
        wasteDetail = 'أدخل أوزان وأسعار الخامات لحساب الهالك';
      }
    } else {
      wasteAmount = wasteValue * avgPricePerKg;
      wasteLabel = `هالك ${fmtQty(wasteValue)} كجم`;
      if (wasteValue > 0 && avgPricePerKg > 0) {
        wasteDetail = `${fmtQty(wasteValue)} كجم × متوسط ${fmtQty(avgPricePerKg)} ج/كجم = ${formatMoney(wasteAmount)}`;
      } else if (wasteValue > 0) {
        wasteDetail = 'أدخل أسعار الخامات لحساب الهالك';
      }
    }

    const expenses = n(form.expenses);
    const expensesDetail = expenses > 0 ? `مبلغ ثابت = ${formatMoney(expenses)}` : '';

    const extra = ratesTotal + wasteAmount + expenses;
    const costTotal = material + extra;
    const costPerKg = weight > 0 ? costTotal / weight : 0;
    const profitPct = n(form.profitPct);
    const profitAmount = costTotal * (profitPct / 100);
    const sellTotal = costTotal + profitAmount;
    const sellPerKg = weight > 0 ? sellTotal / weight : 0;

    return {
      materialLines,
      weight,
      avgPricePerKg,
      material,
      rateLines,
      ratesTotal,
      wasteAmount,
      wasteDetail,
      wasteLabel,
      expenses,
      expensesDetail,
      extra,
      costTotal,
      costPerKg,
      profitPct,
      profitAmount,
      sellTotal,
      sellPerKg,
    };
  }, [form]);

  function reset() {
    setForm({
      materials: [emptyMaterial()],
      rates: emptyRates(),
      customRates: [],
      wasteMode: 'pct',
      wasteValue: '',
      expenses: '',
      profitPct: '',
    });
  }

  function setMaterial(id: number, patch: Partial<MaterialLine>) {
    setForm((f) => ({
      ...f,
      materials: f.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="حاسبة تكلفة المنتج"
        subtitle="أضف خامات متعددة بعلامة + · اكتب الوزن والسعر لكل خامة · والتنقل بالأسهم ↓↑"
        icon={Calculator}
        actions={(
          <Button variant="secondary" onClick={reset}>
            <RotateCcw size={14} /> تفريغ
          </Button>
        )}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" data-nav-root="">
        <Card className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-extrabold text-slate-800">الخامات</div>
                <p className="text-xs text-slate-500">أضف كل مادة بوزنها وسعر الكيلو — الإجمالي يتجمع تلقائيًا</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setForm((f) => ({ ...f, materials: [...f.materials, emptyMaterial()] }))}
              >
                <Plus size={14} /> خامة
              </Button>
            </div>
            <div className="space-y-2">
              {form.materials.map((mat, index) => {
                const line = calc.materialLines.find((m) => m.id === mat.id);
                return (
                  <div key={mat.id} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-[1.2fr_6rem_7rem_7rem_2rem]">
                    <Field label={index === 0 ? 'اسم الخامة' : undefined}>
                      <Input
                        value={mat.name}
                        onChange={(e) => setMaterial(mat.id, { name: e.target.value })}
                        placeholder={`خامة ${index + 1}`}
                      />
                    </Field>
                    <Field label={index === 0 ? 'الوزن' : undefined}>
                      <NumberInput
                        value={mat.weight}
                        onValueChange={(weight) => setMaterial(mat.id, { weight })}
                        placeholder="كجم"
                      />
                    </Field>
                    <Field label={index === 0 ? 'سعر/كجم' : undefined}>
                      <NumberInput
                        value={mat.pricePerKg}
                        onValueChange={(pricePerKg) => setMaterial(mat.id, { pricePerKg })}
                        placeholder="جنيه"
                      />
                    </Field>
                    <div className={`flex flex-col justify-end ${index === 0 ? 'pb-0' : ''}`}>
                      {index === 0 && <div className="mb-1.5 text-[13px] font-semibold text-transparent">.</div>}
                      <div className="flex h-10 items-center justify-end text-sm font-black money-num text-slate-800" dir="ltr">
                        {formatMoney(line?.amount || 0)}
                      </div>
                    </div>
                    <div className="flex items-end justify-center">
                      {index === 0 && <div className="mb-1.5 text-[13px] font-semibold text-transparent">.</div>}
                      <button
                        type="button"
                        title="حذف الخامة"
                        disabled={form.materials.length === 1}
                        onClick={() => setForm((f) => ({ ...f, materials: f.materials.filter((m) => m.id !== mat.id) }))}
                        className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {calc.material > 0 && (
              <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                إجمالي الخامات: {fmtQty(calc.weight)} كجم ·{' '}
                <span className="money-num font-black" dir="ltr">{formatMoney(calc.material)}</span>
              </p>
            )}
          </div>

          <div>
            <div className="mb-1 text-sm font-extrabold text-slate-800">تكاليف التشغيل (سعر للكيلو)</div>
            <p className="mb-3 text-xs text-slate-500">السعر × إجمالي وزن كل الخامات</p>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[1fr_7rem_6rem_8rem_2rem] items-center gap-2 bg-slate-100 px-3 py-2 text-[11px] font-extrabold text-slate-600">
                <span>البند</span>
                <span>السعر / كجم</span>
                <span className="text-center">× الوزن</span>
                <span className="text-left">= الإجمالي</span>
                <span />
              </div>
              {RATE_COST_FIELDS.map((field) => {
                const line = calc.rateLines.find((l) => l.key === field.key)!;
                return (
                  <CostRow
                    key={field.key}
                    label={<span className="font-bold text-slate-800">{field.label}</span>}
                    rate={form.rates[field.key]}
                    onRate={(rate) => setForm((f) => ({ ...f, rates: { ...f.rates, [field.key]: rate } }))}
                    weight={calc.weight}
                    amount={line.amount}
                  />
                );
              })}
              {form.customRates.map((custom) => {
                const line = calc.rateLines.find((l) => l.key === `custom-${custom.id}`)!;
                return (
                  <CostRow
                    key={custom.id}
                    label={(
                      <Input
                        value={custom.label}
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          customRates: f.customRates.map((c) => (c.id === custom.id ? { ...c, label: e.target.value } : c)),
                        }))}
                        placeholder="اسم البند"
                      />
                    )}
                    rate={custom.rate}
                    onRate={(rate) => setForm((f) => ({
                      ...f,
                      customRates: f.customRates.map((c) => (c.id === custom.id ? { ...c, rate } : c)),
                    }))}
                    weight={calc.weight}
                    amount={line.amount}
                    onRemove={() => setForm((f) => ({ ...f, customRates: f.customRates.filter((c) => c.id !== custom.id) }))}
                  />
                );
              })}
              <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setForm((f) => ({ ...f, customRates: [...f.customRates, { id: Date.now(), label: '', rate: '' }] }))}
                >
                  <Plus size={14} /> بند تكلفة
                </Button>
                <span className="text-sm font-extrabold text-slate-800">
                  إجمالي التشغيل: <span className="money-num" dir="ltr">{formatMoney(calc.ratesTotal)}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-extrabold text-amber-950">الهالك</div>
              <div className="flex overflow-hidden rounded-lg border border-amber-300 bg-white text-xs font-bold">
                <button
                  type="button"
                  className={`px-3 py-1.5 transition ${form.wasteMode === 'pct' ? 'bg-amber-500 text-white' : 'text-amber-900 hover:bg-amber-100'}`}
                  onClick={() => setForm((f) => ({ ...f, wasteMode: 'pct', wasteValue: '' }))}
                >
                  نسبة %
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 transition ${form.wasteMode === 'kg' ? 'bg-amber-500 text-white' : 'text-amber-900 hover:bg-amber-100'}`}
                  onClick={() => setForm((f) => ({ ...f, wasteMode: 'kg', wasteValue: '' }))}
                >
                  وزن (كجم)
                </button>
              </div>
            </div>
            <Field label={form.wasteMode === 'pct' ? 'نسبة الهالك %' : 'وزن الهالك (كجم)'}>
              <NumberInput
                value={form.wasteValue}
                onValueChange={(wasteValue) => setForm((f) => ({ ...f, wasteValue }))}
                placeholder={form.wasteMode === 'pct' ? 'مثال: 3' : 'مثال: 2'}
              />
            </Field>
            {calc.wasteDetail && (
              <p className="text-[11px] font-semibold text-amber-900/80">{calc.wasteDetail}</p>
            )}
          </div>

          <div className="space-y-1">
            <Field label="مصروفات (مبلغ ثابت)">
              <NumberInput
                value={form.expenses}
                onValueChange={(expenses) => setForm((f) => ({ ...f, expenses }))}
                placeholder="0"
              />
            </Field>
          </div>

          <Field label="نسبة الربح %">
            <NumberInput
              value={form.profitPct}
              onValueChange={(profitPct) => setForm((f) => ({ ...f, profitPct }))}
              placeholder="مثال: 20"
            />
          </Field>
        </Card>

        <div className="space-y-3">
          <Card className="border-2 border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-600">تكلفة الخامات</div>
            <div className="mt-1 text-2xl font-black money-num text-slate-950">{formatMoney(calc.material)}</div>
            <ul className="mt-2 space-y-1 text-[11px] font-semibold text-slate-600">
              {calc.materialLines.filter((m) => m.amount > 0).map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span>{m.label} · {fmtQty(m.weight)}×{fmtQty(m.pricePerKg)}</span>
                  <span className="money-num" dir="ltr">{formatMoney(m.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="border-2 border-amber-300 bg-amber-50">
            <div className="text-xs font-bold text-amber-900">إجمالي التكاليف الإضافية</div>
            <div className="mt-1 text-2xl font-black money-num text-amber-950">{formatMoney(calc.extra)}</div>
            <ul className="mt-3 space-y-2 text-xs font-semibold text-amber-950/85">
              {calc.rateLines.filter((c) => c.amount > 0).map((c) => (
                <li key={c.key} className="border-b border-amber-200/60 pb-1.5 last:border-0">
                  <div className="flex justify-between gap-2">
                    <span>{c.label}</span>
                    <span className="money-num" dir="ltr">{formatMoney(c.amount)}</span>
                  </div>
                </li>
              ))}
              {calc.wasteAmount > 0 && (
                <li className="flex justify-between gap-2 border-b border-amber-200/60 pb-1.5">
                  <span>{calc.wasteLabel}</span>
                  <span className="money-num" dir="ltr">{formatMoney(calc.wasteAmount)}</span>
                </li>
              )}
              {calc.expenses > 0 && (
                <li className="flex justify-between gap-2">
                  <span>مصروفات</span>
                  <span className="money-num" dir="ltr">{formatMoney(calc.expenses)}</span>
                </li>
              )}
              {calc.extra <= 0 && <li className="text-amber-800/70">لم تُضف تكاليف بعد</li>}
            </ul>
          </Card>

          <Card className="border-2 border-rose-300 bg-rose-50">
            <div className="text-xs font-bold text-rose-900">سعر التكلفة</div>
            <div className="mt-1 text-3xl font-black money-num text-rose-950">{formatMoney(calc.costTotal)}</div>
            <div className="mt-1 text-sm font-bold text-rose-800">
              للكيلو: <span className="money-num" dir="ltr">{formatMoney(calc.costPerKg)}</span>
            </div>
          </Card>

          <Card className="border-2 border-emerald-400 bg-emerald-50">
            <div className="text-xs font-bold text-emerald-900">هبيع بكام (بعد نسبة الربح {calc.profitPct || 0}%)</div>
            <div className="mt-1 text-3xl font-black money-num text-emerald-950">{formatMoney(calc.sellTotal)}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm font-bold text-emerald-900">
              <span>الربح: <span className="money-num" dir="ltr">{formatMoney(calc.profitAmount)}</span></span>
              <span>سعر بيع الكيلو: <span className="money-num" dir="ltr">{formatMoney(calc.sellPerKg)}</span></span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
