/** تجهيز الطباعة: فاتورة بنسختين في أول صفحة · كشف حساب كامل بدون قص */
export function installPrintPrep() {
  const MOUNT_ID = 'invoice-print-mount';

  const clearStatementScale = () => {
    document.querySelectorAll<HTMLElement>('.statement-sheet, .statement-fit-host').forEach((el) => {
      el.style.removeProperty('transform');
      el.style.removeProperty('transform-origin');
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('max-height');
      el.style.removeProperty('overflow');
      el.removeAttribute('data-print-scale');
    });
  };

  const prep = () => {
    const dual = document.querySelector('.dual-print-root');
    if (dual) {
      let mount = document.getElementById(MOUNT_ID);
      if (!mount) {
        mount = document.createElement('div');
        mount.id = MOUNT_ID;
        document.body.insertBefore(mount, document.body.firstChild);
      }
      mount.innerHTML = '';
      const clone = dual.cloneNode(true) as HTMLElement;
      clone.classList.add('dual-print-root--mounted');
      clone.querySelectorAll('.print-only, .dual-print-clone').forEach((el) => {
        (el as HTMLElement).style.display = 'block';
        (el as HTMLElement).style.visibility = 'visible';
      });
      mount.appendChild(clone);
      document.body.classList.add('is-printing', 'printing-dual-invoice');
      document.documentElement.style.setProperty('--print-sheet-h', '100vh');
      return;
    }

    document.getElementById(MOUNT_ID)?.remove();
    clearStatementScale();

    const statement = document.querySelector<HTMLElement>('.statement-sheet');
    if (statement) {
      // إلغاء أي تصغير شاشة وفتح الحاويات عشان الطباعة تظهر كاملة
      const sheets = Array.from(document.querySelectorAll<HTMLElement>('.print-sheet, .statement-fullscreen, .statement-fullscreen-body, .statement-fit-host'));
      for (const el of sheets) {
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        el.style.overflow = 'visible';
        el.style.transform = 'none';
        el.style.position = el.classList.contains('statement-fullscreen') ? 'static' : el.style.position;
      }
      statement.style.transform = 'none';
      statement.style.width = '100%';
      statement.style.height = 'auto';
      statement.style.overflow = 'visible';

      const h = Math.max(statement.scrollHeight, statement.offsetHeight, document.body.scrollHeight);
      document.documentElement.style.setProperty('--print-sheet-h', `${Math.ceil(h + 64)}px`);
      document.body.classList.add('is-printing', 'printing-statement');
      return;
    }

    const sheets = Array.from(document.querySelectorAll<HTMLElement>('.print-sheet'));
    if (!sheets.length) return;
    let max = 0;
    for (const el of sheets) {
      el.style.maxHeight = 'none';
      el.style.height = 'auto';
      el.style.overflow = 'visible';
      const h = Math.max(el.scrollHeight, el.offsetHeight);
      if (h > max) max = h;
    }
    document.documentElement.style.setProperty('--print-sheet-h', `${Math.ceil(max + 48)}px`);
    document.body.classList.add('is-printing');
  };

  const cleanup = () => {
    document.getElementById(MOUNT_ID)?.remove();
    clearStatementScale();
    document.querySelectorAll<HTMLElement>('.print-sheet, .statement-fullscreen, .statement-fullscreen-body, .statement-fit-host, .statement-sheet').forEach((el) => {
      el.style.removeProperty('max-height');
      el.style.removeProperty('height');
      el.style.removeProperty('overflow');
      el.style.removeProperty('transform');
      el.style.removeProperty('width');
      el.style.removeProperty('position');
    });
    document.body.classList.remove('is-printing', 'printing-dual-invoice', 'printing-statement');
    document.documentElement.style.removeProperty('--print-sheet-h');
    // إعادة ملاءمة الشاشة بعد الطباعة
    window.dispatchEvent(new Event('resize'));
  };

  window.addEventListener('beforeprint', prep);
  window.addEventListener('afterprint', cleanup);
}
