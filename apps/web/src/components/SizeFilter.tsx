import { Ruler, X } from 'lucide-react';
import { NumberInput } from './ui';

export function SizeFilter({
  width,
  thickness,
  onWidth,
  onThickness,
}: {
  width: number | '';
  thickness: number | '';
  onWidth: (value: number | '') => void;
  onThickness: (value: number | '') => void;
}) {
  const active = width !== '' || thickness !== '';
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm no-print">
      <span className="inline-flex items-center gap-1.5 font-bold text-slate-600"><Ruler size={15} /> بحث بالمقاس</span>
      <div className="w-32"><NumberInput value={width} onValueChange={onWidth} placeholder="العرض (سم)" /></div>
      <span className="text-slate-400">×</span>
      <div className="w-32"><NumberInput value={thickness} onValueChange={onThickness} placeholder="السمك (سم)" /></div>
      {active && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100"
          onClick={() => { onWidth(''); onThickness(''); }}
        >
          <X size={12} /> مسح
        </button>
      )}
    </div>
  );
}
