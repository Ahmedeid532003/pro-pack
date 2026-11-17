import { useEffect, useState } from 'react';
import { ArrowRight, Printer } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../lib/feedback';
import { StatementLedger, type LedgerRow } from '../components/StatementLedger';
import { Button, Empty, PageSkeleton } from '../components/ui';

type StatementPayload = {
  customer?: { id: string; code: string; name: string; balance: number };
  supplier?: { id: string; code: string; name: string; balance: number };
  statement: LedgerRow[];
  balance: number;
  totals?: { debit: number; credit: number; balance: number };
  prepaid?: number;
  meaning?: string;
};

export function StatementDetailPage() {
  const { kind = 'customer', id = '' } = useParams<{ kind: string; id: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<StatementPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const partyKind = kind === 'supplier' ? 'supplier' : 'customer';
  const backTo = search.get('from') || (partyKind === 'supplier' ? '/suppliers' : '/customers');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const path = partyKind === 'customer' ? `/customers/${id}/statement` : `/suppliers/${id}/statement`;
    api<StatementPayload>(path)
      .then(setData)
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'تعذر تحميل كشف الحساب');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [id, partyKind]);

  const party = data?.customer || data?.supplier;
  const meaning = data?.meaning || (
    partyKind === 'customer'
      ? (data && data.balance > 0.009 ? 'دائن على العميل (−)' : data && data.balance < -0.009 ? 'مدين للعميل (+ مقدم)' : 'متعادل')
      : (data && data.balance > 0.009 ? 'مدين للمورد (−)' : data && data.balance < -0.009 ? 'دائن عند المورد (+ مقدم)' : 'متعادل')
  );

  function goBack() {
    if (window.history.length > 1 && !search.get('from')) navigate(-1);
    else navigate(backTo);
  }

  return (
    <div className="statement-fullscreen fixed inset-0 z-[70] flex flex-col bg-slate-50 print-sheet">
      <div className="no-print flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="secondary" onClick={goBack}>
            <ArrowRight size={16} /> رجوع
          </Button>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900">
              كشف حساب {partyKind === 'customer' ? 'عميل' : 'مورد'}
              {party ? ` — ${party.name}` : ''}
            </div>
            {party && (
              <div className="truncate text-[11px] font-bold text-slate-500" dir="ltr">
                {party.code}
              </div>
            )}
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            window.dispatchEvent(new Event('beforeprint'));
            window.setTimeout(() => window.print(), 80);
          }}
        >
          <Printer size={16} /> طباعة
        </Button>
      </div>

      <div className="statement-fullscreen-body min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        {loading ? (
          <PageSkeleton />
        ) : !data || !party ? (
          <div className="grid h-full place-items-center">
            <Empty text="تعذر عرض كشف الحساب" hint="ارجع للقائمة وحاول مرة أخرى" />
            <Button className="mt-3" onClick={goBack}>رجوع</Button>
          </div>
        ) : (
          <StatementLedger
            data={{
              title: partyKind === 'customer' ? 'كشف حساب عميل' : 'كشف حساب مورد',
              partyName: party.name,
              partyCode: party.code,
              partyKind,
              balance: data.balance,
              meaning,
              prepaid: data.prepaid,
              totals: data.totals,
              statement: data.statement,
              fileName: `كشف-${partyKind === 'customer' ? 'عميل' : 'مورد'}-${party.code}.xlsx`,
            }}
          />
        )}
      </div>
    </div>
  );
}
