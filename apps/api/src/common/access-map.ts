/** مصدر واحد للصلاحيات — مشترك مع الواجهة */
export {
  type PageId,
  type PageGrant,
  type AccessMap,
  type PageDef,
  PAGES,
  emptyGrant,
  fullAccess,
  templateFor,
  normalizeAccess,
  parseAccess,
  canDo,
  hiddenResponseKeys,
  stripHidden,
} from '@m5azen/shared';
