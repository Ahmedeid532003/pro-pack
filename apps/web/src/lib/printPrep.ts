/** تجهيز الطباعة: فاتورة بنسختين في أول صفحة · كشف حساب في صفحة واحدة بالتصغير */
export function installPrintPrep() {
  const MOUNT_ID = 'invoice-print-mount';

  const clearStatementScale = () => {
    document.querySelectorAll<HTMLElement>('.statement-sheet').forEach((el) => {
      el.style.removeProperty('transform');
      el.style.removeProperty('transform-origin');
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.removeAttribute('data-print-scale');
    });
  };

  const prep = () => {
    const dual = document.querySelector('.dual-print-root');
    if (dual) {
      // انسخ الفاتورة لأول الـ body عشان تطلع في الصفحة الأولى (من غير صفحة فاضية)
      let mount = document.getElementById(MOUNT_ID);
      if (!mount) {
        mount = document.createElement('div');
        mount.id = MOUNT_ID;
        document.body.insertBefore(mount, document.body.firstChild);
      }
      mount.innerHTML = '';
      const clone = dual.cloneNode(true) as HTMLElement;
      clone.classList.add('dual-print-root--mounted');
      // أظهر النسخة المستنسخة حتى لو كانت print-only في الأصل
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
      const sheets = Array.from(document.querySelectorAll<HTMLElement>('.print-sheet'));
      for (const el of sheets) {
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        el.style.overflow = 'visible';
      }

      // قياس الارتفاع الطبيعي ثم تصغير لصفحة A4 واحدة
      statement.style.transform = 'none';
      const naturalH = Math.max(statement.scrollHeight, statement.offsetHeight);
      const naturalW = Math.max(statement.scrollWidth, statement.offsetWidth);
      // هامش @page 5mm ×2 ≈ مساحة طباعة تقريبية لـ A4 عمودي
      const pageH = Math.min(window.innerHeight, 1120);
      const pageW = Math.min(window.innerWidth, 794);
      const scale = Math.min(1, (pageH - 8) / Math.max(naturalH, 1), (pageW - 8) / Math.max(naturalW, 1));
      const safe = Math.max(0.35, Math.min(1, scale));
      statement.style.transformOrigin = 'top center';
      statement.style.transform = `scale(${safe})`;
      statement.setAttribute('data-print-scale', String(safe));
      // عوّض العرض بعد scale عشان ما يحصلش قص أفقي
      if (safe < 0.999) {
        statement.style.width = `${100 / safe}%`;
      }

      document.documentElement.style.setProperty('--print-sheet-h', '100vh');
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
    document.body.classList.remove('is-printing', 'printing-dual-invoice', 'printing-statement');
    document.documentElement.style.removeProperty('--print-sheet-h');
  };

  window.addEventListener('beforeprint', prep);
  window.addEventListener('afterprint', cleanup);
}
