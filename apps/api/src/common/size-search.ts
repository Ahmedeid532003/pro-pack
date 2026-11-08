import type { Prisma } from '@prisma/client';

function near(value: number) {
  return { gte: value - 0.0001, lte: value + 0.0001 };
}

function num(raw?: string | null) {
  if (raw == null || String(raw).trim() === '') return undefined;
  const value = Number(String(raw).replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Size terms for product search: "30x0.5" / "30*0.5" / "30×0.5" means width × thickness,
 * a bare number matches either width or thickness.
 */
export function productSizeTerms(search?: string): Prisma.ProductWhereInput[] {
  const text = (search || '').trim();
  if (!text) return [];
  const pair = text.match(/^(\d+(?:[.,]\d+)?)\s*[x×*X]\s*(\d+(?:[.,]\d+)?)$/);
  if (pair) {
    const width = num(pair[1])!;
    const thickness = num(pair[2])!;
    return [{ AND: [{ width: near(width) }, { thickness: near(thickness) }] }];
  }
  const single = num(text);
  if (single === undefined) return [];
  return [{ width: near(single) }, { thickness: near(single) }];
}

/** Explicit width / thickness filters (each optional). */
export function productSizeFilter(width?: string, thickness?: string): Prisma.ProductWhereInput | undefined {
  const w = num(width);
  const t = num(thickness);
  if (w === undefined && t === undefined) return undefined;
  return {
    ...(w !== undefined ? { width: near(w) } : {}),
    ...(t !== undefined ? { thickness: near(t) } : {}),
  };
}

export function sizeLabel(width?: number | null, thickness?: number | null) {
  if (width == null && thickness == null) return '';
  return `${width ?? '—'} × ${thickness ?? '—'} سم`;
}
