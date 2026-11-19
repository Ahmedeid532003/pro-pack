import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** تنقل بين حقول النموذج بأسهم لوحة المفاتيح */
export function focusNavSibling(current: HTMLElement, direction: 'next' | 'prev') {
  const root = current.closest('[data-nav-root]') || document.body;
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>('input[data-nav], textarea[data-nav], select[data-nav], [data-nav]:is(input, textarea, select)'),
  ).filter((el) => !el.hasAttribute('disabled') && !(el as HTMLInputElement).readOnly && el.offsetParent !== null);

  const index = nodes.indexOf(current);
  if (index < 0) return;
  const target = direction === 'next' ? nodes[index + 1] : nodes[index - 1];
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const len = target.value?.length ?? 0;
    try { target.setSelectionRange(len, len); } catch { /* ignore */ }
  }
}

export function onFormNavKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
  // السهم في select يغيّر الخيار — سيّبه للمتصفح
  if (event.currentTarget.tagName === 'SELECT') return;
  event.preventDefault();
  focusNavSibling(event.currentTarget, key === 'ArrowDown' ? 'next' : 'prev');
}
