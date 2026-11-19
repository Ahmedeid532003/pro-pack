/**
 * كود النظام تلقائي.
 * لو المستخدم بعت قيمة تُستخدم كما هي؛ وإلا يتولّد كود فريد بالبادئة.
 */
export function autoCode(prefix: string, value?: string | null) {
  const trimmed = (value || '').trim();
  if (trimmed) return trimmed;
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${stamp}${rand}`;
}
