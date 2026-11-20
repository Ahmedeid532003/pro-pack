import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Boxes,
  Calculator,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  LineChart,
  Factory,
  FileSpreadsheet,
  Handshake,
  Package,
  PackageCheck,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Truck,
  Undo2,
  Users,
  UserCog,
  Wallet,
  Warehouse,
} from 'lucide-react';

export type AppRole = 'ADMIN' | 'ACCOUNTANT' | 'WAREHOUSE' | 'SALES';

export type NavItem = {
  to: string;
  label: string;
  page: string;
  icon: LucideIcon;
  end?: boolean;
  keywords: string;
  roles?: AppRole[];
  /** حرف الاختصار مع Ctrl (مثل D → Ctrl+D). */
  shortcut?: string;
};

/** عرض الاختصار جنب عناصر القائمة */
export function shortcutLabel(key?: string) {
  if (!key) return '';
  return `Ctrl+${key.toUpperCase()}`;
}

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'مدير النظام',
  ACCOUNTANT: 'محاسب',
  WAREHOUSE: 'أمين مخزن',
  SALES: 'مبيعات',
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'نظرة عامة',
    items: [
      { to: '/', label: 'لوحة التحكم', page: 'dashboard', icon: LayoutDashboard, end: true, keywords: 'dashboard رئيسية', shortcut: 'D' },
    ],
  },
  {
    label: 'المخزون',
    items: [
      { to: '/warehouses', label: 'المخازن', page: 'warehouses', icon: Warehouse, keywords: 'مخزن warehouse', shortcut: 'W' },
      { to: '/products', label: 'إضافة أصناف', page: 'products', icon: Package, keywords: 'صنف منتج product استيراد import أصناف', shortcut: 'O' },
      { to: '/stock', label: 'المخزون', page: 'stock', icon: Boxes, keywords: 'رصيد حركة stock', shortcut: 'I' },
      { to: '/production', label: 'مراحل التصنيع', page: 'production', icon: Factory, keywords: 'تصنيع طباعة تبطين سلتر تفصيل خام production', roles: ['ADMIN', 'WAREHOUSE', 'ACCOUNTANT'], shortcut: 'E' },
      { to: '/costing', label: 'حاسبة التكلفة', page: 'production', icon: Calculator, keywords: 'تكلفة ربح طباعة تبطين سليدر تفصيل صمغ هالك مصروفات سعر بيع costing', roles: ['ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'SALES'], shortcut: 'Q' },
      { to: '/prod-orders', label: 'أمر إنتاج', page: 'production', icon: ClipboardList, keywords: 'أمر انتاج أوردر طلب عميل delivery', roles: ['ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'SALES'], shortcut: 'Y' },
    ],
  },
  {
    label: 'الأطراف',
    items: [
      { to: '/suppliers', label: 'الموردين', page: 'suppliers', icon: Truck, keywords: 'مورد supplier', shortcut: 'B' },
      { to: '/customers', label: 'العملاء', page: 'customers', icon: Users, keywords: 'عميل customer', shortcut: 'U' },
    ],
  },
  {
    label: 'العمليات',
    items: [
      { to: '/sales', label: 'المبيعات', page: 'sales', icon: ShoppingCart, keywords: 'فاتورة بيع sales', shortcut: 'S' },
      { to: '/purchases', label: 'المشتريات', page: 'purchases', icon: ShoppingBag, keywords: 'فاتورة شراء purchase', shortcut: 'G' },
      { to: '/returns', label: 'المرتجعات', page: 'returns', icon: Undo2, keywords: 'مرتجع return', shortcut: 'T' },
      { to: '/documents', label: 'عروض وأوامر', page: 'documents', icon: ClipboardList, keywords: 'عرض سعر أمر', shortcut: 'N' },
      { to: '/delivery-notes', label: 'إذن تسليم بضاعة', page: 'documents', icon: PackageCheck, keywords: 'إذن تسليم بضاعة توقيع مستلم delivery', shortcut: 'J' },
      { to: '/cash', label: 'الخزنة', page: 'cash', icon: Wallet, keywords: 'نقدي خزنة cash', shortcut: 'X' },
    ],
  },
  {
    label: 'المالية',
    items: [
      { to: '/finance', label: 'المالية', page: 'finance', icon: Landmark, keywords: 'مصروف شيك وردية', shortcut: 'M' },
      { to: '/hr', label: 'الموارد البشرية', page: 'hr', icon: UserCog, keywords: 'مرتبات حضور عمولة موظف payroll hr', roles: ['ADMIN', 'ACCOUNTANT'], shortcut: 'H' },
      { to: '/partners', label: 'الشركاء', page: 'partners', icon: Handshake, keywords: 'شريك أرباح سحب partner', roles: ['ADMIN', 'ACCOUNTANT'], shortcut: 'L' },
      { to: '/statements', label: 'كشوف حسابات', page: 'statements', icon: FileSpreadsheet, keywords: 'كشف حساب عميل مورد دائن مدين لينا علينا مقدم statement', roles: ['ADMIN', 'ACCOUNTANT'], shortcut: 'A' },
      { to: '/reports', label: 'التقارير', page: 'reports', icon: BarChart3, keywords: 'تقرير report', shortcut: 'R' },
      { to: '/analytics', label: 'التحليلات', page: 'analytics', icon: LineChart, keywords: 'تحليل analytics نمو', shortcut: 'F' },
      { to: '/insights', label: 'التنبيهات الذكية', page: 'insights', icon: Sparkles, keywords: 'تنبيه صلاحية نقص', shortcut: 'P' },
    ],
  },
  {
    label: 'النظام',
    items: [
      { to: '/settings', label: 'الإعدادات', page: 'settings', icon: Settings, keywords: 'إعداد مستخدم نسخ', shortcut: 'C' },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

/** خريطة Ctrl+حرف → عنصر القائمة (يعمل مع لوحة عربية عبر event.code) */
export const NAV_SHORTCUT_MAP = new Map(
  NAV_ITEMS.filter((item) => item.shortcut).map((item) => [item.shortcut!.toUpperCase(), item]),
);

export function canAccess(role: string | undefined, roles?: AppRole[]) {
  if (!roles?.length) return true;
  if (role === 'ADMIN') return true;
  return !!role && roles.includes(role as AppRole);
}

export const QUICK_ACTIONS: { to: string; label: string; page: string; roles?: AppRole[] }[] = [
  { to: '/sales', label: 'فاتورة مبيعات', page: 'sales', roles: ['ADMIN', 'SALES', 'ACCOUNTANT'] },
  { to: '/purchases', label: 'فاتورة مشتريات', page: 'purchases', roles: ['ADMIN', 'ACCOUNTANT', 'WAREHOUSE'] },
  { to: '/products', label: 'إضافة أصناف', page: 'products' },
  { to: '/stock', label: 'المخزون', page: 'stock' },
  { to: '/cash', label: 'حركة خزنة', page: 'cash', roles: ['ADMIN', 'ACCOUNTANT'] },
  { to: '/reports', label: 'التقارير', page: 'reports' },
];
