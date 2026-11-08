export function sizeText(width?: number | null, thickness?: number | null) {
  if (width == null && thickness == null) return '';
  return `${width ?? '—'} × ${thickness ?? '—'} سم`;
}

export const optionalNumber = (value: number | '' | null | undefined) => (value === '' || value == null ? null : value);
