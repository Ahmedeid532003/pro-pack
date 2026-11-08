import { api } from './api';

type Prompt = (options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  inputType?: 'text' | 'password';
  placeholder?: string;
  danger?: boolean;
}) => Promise<string | null>;

/**
 * Asks for the invoice delete password (set in Settings) and deletes the invoice.
 * Returns false when the user cancels.
 */
export async function deleteInvoiceWithPassword(prompt: Prompt, path: string, label: string) {
  const password = await prompt({
    title: `حذف ${label}`,
    message: 'الحذف بيرجّع المخزون، وأي مبلغ اتدفع بيرجع للخزنة ويظهر كحركة في الخزنة. اكتب كلمة سر حذف الفواتير (من الإعدادات) للتأكيد.',
    inputType: 'password',
    placeholder: 'كلمة سر الحذف',
    confirmLabel: 'حذف الفاتورة',
    danger: true,
  });
  if (password === null) return false;
  await api(path, { method: 'DELETE', headers: { 'x-delete-password': encodeURIComponent(password) } });
  return true;
}
