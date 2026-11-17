import { Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STOCK_COUNT_KEY, STOCK_COUNT_REF } from '../common/stock-count';
async function loadExcel() {
  return import('exceljs');
}

function sliceInvoiceCost(lines: { productId: string; quantity: number; unitCost: number }[], productId: string) {
  const rows = lines.filter((line) => line.productId === productId && line.quantity > 0);
  const quantity = rows.reduce((sum, line) => sum + line.quantity, 0);
  if (quantity <= 0) return null;
  return Math.round(rows.reduce((sum, line) => sum + line.quantity * (line.unitCost || 0), 0) / quantity * 10000) / 10000;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async inventory(warehouseIds?: string[]) {
    return this.prisma.stockBalance.findMany({
      where: warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : undefined,
      include: { product: true, warehouse: true },
      orderBy: { product: { name: 'asc' } },
    });
  }

  /** بيان جرد: كل أرصدة المخزن مع تاريخ آخر جرد لكل صنف وللمخزن */
  async countSheet(warehouseIds?: string[]) {
    const scope = warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {};
    const [balances, counts, warehouseCounts] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: { ...scope, NOT: { quantity: 0 } },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true, width: true, thickness: true, weight: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ warehouse: { name: 'asc' } }, { product: { name: 'asc' } }],
      }),
      this.prisma.stockMovement.findMany({
        where: { ...scope, type: 'ADJUSTMENT', reference: STOCK_COUNT_REF },
        select: { warehouseId: true, productId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.setting.findMany({ where: { key: { startsWith: `${STOCK_COUNT_KEY}.` } } }),
    ]);
    const lastByItem = new Map<string, Date>();
    for (const row of counts) {
      const key = `${row.warehouseId}:${row.productId}`;
      if (!lastByItem.has(key)) lastByItem.set(key, row.createdAt);
    }
    const lastByWarehouse = new Map(
      warehouseCounts.map((row) => [row.key.slice(STOCK_COUNT_KEY.length + 1), row.value]),
    );
    const rows = balances.map((row) => ({
      warehouse: row.warehouse,
      product: row.product,
      quantity: row.quantity,
      lastCountAt: lastByItem.get(`${row.warehouseId}:${row.productId}`) || lastByWarehouse.get(row.warehouseId) || null,
    }));
    const lastCountAt = [...lastByWarehouse.entries()]
      .filter(([id]) => !warehouseIds?.length || warehouseIds.includes(id))
      .map(([, at]) => at)
      .sort()
      .pop() || null;
    return { rows, lastCountAt, totalQty: rows.reduce((sum, row) => sum + row.quantity, 0) };
  }

  async salesSummary(from?: string, to?: string, warehouseIds?: string[]) {
    const invoiceDate = this.dayRange(from, to);
    const where = {
      status: { not: 'CANCELLED' as const },
      ...(warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {}),
      ...(invoiceDate ? { invoiceDate } : {}),
    };
    const invoices = await this.prisma.salesInvoice.findMany({
      where,
      include: {
        customer: true,
        warehouse: true,
        lines: { include: { product: { select: { sku: true, name: true, unit: true } } } },
        receipts: { select: { number: true, amount: true, receivedAt: true, paymentMethod: true } },
      },
      orderBy: { invoiceDate: 'desc' },
    });
    const total = invoices.reduce((s, i) => s + i.total, 0);
    const paid = invoices.reduce((s, i) => s + i.paidAmount, 0);
    const due = Math.max(0, total - paid);
    const byCustomer = new Map<string, { name: string; total: number; paid: number; count: number }>();
    const byProduct = new Map<string, { sku: string; name: string; qty: number; amount: number }>();
    for (const inv of invoices) {
      const c = byCustomer.get(inv.customerId) || { name: inv.customer.name, total: 0, paid: 0, count: 0 };
      c.total += inv.total;
      c.paid += inv.paidAmount;
      c.count += 1;
      byCustomer.set(inv.customerId, c);
      for (const line of inv.lines) {
        const key = line.productId;
        const row = byProduct.get(key) || { sku: line.product.sku, name: line.product.name, qty: 0, amount: 0 };
        row.qty += line.quantity;
        row.amount += line.total;
        byProduct.set(key, row);
      }
    }
    return {
      invoices,
      total,
      paid,
      due,
      count: invoices.length,
      byCustomer: [...byCustomer.values()].sort((a, b) => b.total - a.total),
      byProduct: [...byProduct.values()].sort((a, b) => b.amount - a.amount),
      lineCount: invoices.reduce((s, i) => s + i.lines.length, 0),
    };
  }

  async purchasesSummary(from?: string, to?: string, warehouseIds?: string[]) {
    const invoiceDate = this.dayRange(from, to);
    const where = {
      status: { not: 'CANCELLED' as const },
      ...(warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {}),
      ...(invoiceDate ? { invoiceDate } : {}),
    };
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where,
      include: {
        supplier: true,
        warehouse: true,
        lines: { include: { product: { select: { sku: true, name: true, unit: true } } } },
        payments: { select: { number: true, amount: true, paidAt: true, paymentMethod: true } },
      },
      orderBy: { invoiceDate: 'desc' },
    });
    const total = invoices.reduce((s, i) => s + i.total, 0);
    const paid = invoices.reduce((s, i) => s + i.paidAmount, 0);
    const due = Math.max(0, total - paid);
    const bySupplier = new Map<string, { name: string; total: number; paid: number; count: number }>();
    const byProduct = new Map<string, { sku: string; name: string; qty: number; amount: number }>();
    for (const inv of invoices) {
      const sRow = bySupplier.get(inv.supplierId) || { name: inv.supplier.name, total: 0, paid: 0, count: 0 };
      sRow.total += inv.total;
      sRow.paid += inv.paidAmount;
      sRow.count += 1;
      bySupplier.set(inv.supplierId, sRow);
      for (const line of inv.lines) {
        const key = line.productId;
        const row = byProduct.get(key) || { sku: line.product.sku, name: line.product.name, qty: 0, amount: 0 };
        row.qty += line.quantity;
        row.amount += line.total;
        byProduct.set(key, row);
      }
    }
    return {
      invoices,
      total,
      paid,
      due,
      count: invoices.length,
      bySupplier: [...bySupplier.values()].sort((a, b) => b.total - a.total),
      byProduct: [...byProduct.values()].sort((a, b) => b.amount - a.amount),
      lineCount: invoices.reduce((s, i) => s + i.lines.length, 0),
    };
  }

  async overview(from?: string, to?: string, warehouseIds?: string[]) {
    const [sales, purchases, profit, cash, customers, suppliers, finance, hr, production, inventory] = await Promise.all([
      this.salesSummary(from, to, warehouseIds),
      this.purchasesSummary(from, to, warehouseIds),
      this.profit(from, to, warehouseIds),
      this.cashReport(from, to, warehouseIds),
      this.customersReport(),
      this.suppliersReport(),
      this.financeReport(from, to),
      this.hrReport(from, to),
      this.productionReport(from, to, warehouseIds),
      this.inventory(warehouseIds),
    ]);
    const stockQty = inventory.reduce((s, r) => s + r.quantity, 0);
    const stockValue = inventory.reduce((s, r) => s + r.quantity * (r.product.costPrice || 0), 0);
    return {
      period: { from: from || null, to: to || null },
      sales: { total: sales.total, paid: sales.paid, due: sales.due, count: sales.count, lineCount: sales.lineCount },
      purchases: { total: purchases.total, paid: purchases.paid, due: purchases.due, count: purchases.count, lineCount: purchases.lineCount },
      profit: {
        revenue: profit.revenue,
        cogs: profit.cogs,
        expenses: profit.expenses,
        incomes: profit.incomes,
        netProfit: profit.netProfit,
        lineCount: profit.lines?.length || 0,
      },
      cash: { totalIn: cash.totalIn, totalOut: cash.totalOut, net: cash.net, txCount: cash.transactions.length },
      parties: {
        customers: customers.count,
        customerDue: customers.totalDue,
        suppliers: suppliers.count,
        supplierDue: suppliers.totalDue,
      },
      finance: {
        incomes: finance.incomeTotal,
        expenses: finance.expenseTotal,
        net: finance.net,
        transfers: finance.transferTotal,
        pendingChecks: finance.pendingChecks,
      },
      hr: {
        employees: hr.employeeCount,
        salaryTotal: hr.salaryTotal,
        attendance: hr.attendanceCount,
        leaves: hr.leaveCount,
      },
      production: {
        orders: production.orderCount,
        jobs: production.jobCount,
        totalCost: production.totalCost,
      },
      inventory: { rows: inventory.length, qty: stockQty, value: stockValue },
    };
  }

  async returnsReport(from?: string, to?: string, warehouseIds?: string[]) {
    const range = this.dayRange(from, to);
    const wh = warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {};
    const [salesReturns, purchaseReturns] = await Promise.all([
      this.prisma.salesReturn.findMany({
        where: { ...wh, ...(range ? { returnDate: range } : {}) },
        include: {
          customer: true,
          warehouse: true,
          salesInvoice: { select: { number: true } },
          lines: { include: { product: { select: { sku: true, name: true } } } },
        },
        orderBy: { returnDate: 'desc' },
      }),
      this.prisma.purchaseReturn.findMany({
        where: { ...wh, ...(range ? { returnDate: range } : {}) },
        include: {
          supplier: true,
          warehouse: true,
          purchaseInvoice: { select: { number: true } },
          lines: { include: { product: { select: { sku: true, name: true } } } },
        },
        orderBy: { returnDate: 'desc' },
      }),
    ]);
    const salesTotal = salesReturns.reduce((s, r) => s + r.total, 0);
    const purchaseTotal = purchaseReturns.reduce((s, r) => s + r.total, 0);
    return {
      salesReturns,
      purchaseReturns,
      salesTotal,
      purchaseTotal,
      salesCount: salesReturns.length,
      purchaseCount: purchaseReturns.length,
      salesLineCount: salesReturns.reduce((s, r) => s + r.lines.length, 0),
      purchaseLineCount: purchaseReturns.reduce((s, r) => s + r.lines.length, 0),
    };
  }

  async movementsReport(from?: string, to?: string, warehouseIds?: string[]) {
    const createdAt = this.dayRange(from, to);
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        ...(warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      include: {
        product: { select: { sku: true, name: true, unit: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const byType = new Map<string, { count: number; qty: number }>();
    for (const m of movements) {
      const row = byType.get(m.type) || { count: 0, qty: 0 };
      row.count += 1;
      row.qty += m.quantity;
      byType.set(m.type, row);
    }
    return {
      movements,
      count: movements.length,
      byType: [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.count - a.count),
    };
  }

  async profit(from?: string, to?: string, warehouseIds?: string[]) {
    const sales = await this.salesSummary(from, to, warehouseIds);
    const purchases = await this.purchasesSummary(from, to, warehouseIds);
    const invoiceDate = this.dayRange(from, to);
    const expenseDate = this.dayRange(from, to);
    const posted = { in: [InvoiceStatus.CONFIRMED, InvoiceStatus.PARTIAL, InvoiceStatus.PAID] as InvoiceStatus[] };

    const [saleInvoices, returnRows, expenses, incomes] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: {
          status: posted,
          ...(warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {}),
          ...(invoiceDate ? { invoiceDate } : {}),
        },
        include: {
          customer: true,
          lines: { include: { product: true } },
        },
        orderBy: { invoiceDate: 'asc' },
      }),
      this.prisma.salesReturn.findMany({
        where: {
          ...(warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {}),
          ...(invoiceDate ? { returnDate: invoiceDate } : {}),
        },
        include: {
          customer: true,
          salesInvoice: { include: { lines: true } },
          lines: { include: { product: true } },
        },
        orderBy: { returnDate: 'asc' },
      }),
      warehouseIds?.length
        ? Promise.resolve([])
        : this.prisma.expense.findMany({
            where: expenseDate ? { expenseDate } : undefined,
            include: { category: true, account: true },
            orderBy: { expenseDate: 'asc' },
          }),
      warehouseIds?.length
        ? Promise.resolve([])
        : this.prisma.income.findMany({
            where: expenseDate ? { incomeDate: expenseDate } : undefined,
            include: { category: true, account: true },
            orderBy: { incomeDate: 'asc' },
          }),
    ]);

    type ProfitLine = {
      id: string;
      kind: 'REVENUE' | 'RETURN' | 'COGS' | 'COGS_RETURN' | 'EXPENSE' | 'INCOME' | 'DISCOUNT' | 'TAX';
      date: string;
      reference: string;
      party: string;
      description: string;
      quantity: number | null;
      unitAmount: number | null;
      amount: number;
      side: 'IN' | 'OUT';
    };

    const lines: ProfitLine[] = [];
    let revenue = 0;
    let cogs = 0;
    let expenseTotal = 0;
    let incomeTotal = 0;

    for (const inv of saleInvoices) {
      const date = inv.invoiceDate.toISOString();
      for (const line of inv.lines) {
        const unitCost = line.unitCost || line.product.costPrice || 0;
        const cost = Math.round(line.quantity * unitCost * 100) / 100;
        revenue += line.total;
        cogs += cost;
        lines.push({
          id: `rev-${line.id}`,
          kind: 'REVENUE',
          date,
          reference: inv.number,
          party: inv.customer.name,
          description: `${line.product.sku} — ${line.product.name}`,
          quantity: line.quantity,
          unitAmount: line.unitPrice,
          amount: Math.round(line.total * 100) / 100,
          side: 'IN',
        });
        lines.push({
          id: `cogs-${line.id}`,
          kind: 'COGS',
          date,
          reference: inv.number,
          party: inv.customer.name,
          description: `تكلفة ${line.product.sku} — ${line.product.name}`,
          quantity: line.quantity,
          unitAmount: unitCost,
          amount: cost,
          side: 'OUT',
        });
      }
      if (inv.discount > 0.009) {
        revenue -= inv.discount;
        lines.push({
          id: `disc-${inv.id}`,
          kind: 'DISCOUNT',
          date,
          reference: inv.number,
          party: inv.customer.name,
          description: 'خصم الفاتورة',
          quantity: null,
          unitAmount: null,
          amount: Math.round(inv.discount * 100) / 100,
          side: 'OUT',
        });
      }
      if (inv.tax > 0.009) {
        revenue += inv.tax;
        lines.push({
          id: `tax-${inv.id}`,
          kind: 'TAX',
          date,
          reference: inv.number,
          party: inv.customer.name,
          description: 'ضريبة الفاتورة',
          quantity: null,
          unitAmount: null,
          amount: Math.round(inv.tax * 100) / 100,
          side: 'IN',
        });
      }
    }

    for (const ret of returnRows) {
      const date = ret.returnDate.toISOString();
      for (const line of ret.lines) {
        const fromInvoice = !line.unitCost && ret.salesInvoice
          ? sliceInvoiceCost(ret.salesInvoice.lines, line.productId)
          : 0;
        const unitCost = line.unitCost || fromInvoice || line.product.costPrice || 0;
        const cost = Math.round(line.quantity * unitCost * 100) / 100;
        revenue -= line.total;
        cogs -= cost;
        lines.push({
          id: `ret-${line.id}`,
          kind: 'RETURN',
          date,
          reference: ret.number,
          party: ret.customer.name,
          description: `مرتجع ${line.product.sku} — ${line.product.name}`,
          quantity: line.quantity,
          unitAmount: line.unitPrice,
          amount: Math.round(line.total * 100) / 100,
          side: 'OUT',
        });
        lines.push({
          id: `cogsret-${line.id}`,
          kind: 'COGS_RETURN',
          date,
          reference: ret.number,
          party: ret.customer.name,
          description: `استرداد تكلفة ${line.product.sku} — ${line.product.name}`,
          quantity: line.quantity,
          unitAmount: unitCost,
          amount: cost,
          side: 'IN',
        });
      }
    }

    for (const expense of expenses) {
      expenseTotal += expense.amount;
      lines.push({
        id: `exp-${expense.id}`,
        kind: 'EXPENSE',
        date: expense.expenseDate.toISOString(),
        reference: expense.account.name,
        party: expense.category.name,
        description: expense.notes?.trim() || expense.category.name,
        quantity: null,
        unitAmount: null,
        amount: Math.round(expense.amount * 100) / 100,
        side: 'OUT',
      });
    }

    for (const income of incomes) {
      incomeTotal += income.amount;
      lines.push({
        id: `inc-${income.id}`,
        kind: 'INCOME',
        date: income.incomeDate.toISOString(),
        reference: income.account.name,
        party: income.category.name,
        description: income.notes?.trim() || income.category.name,
        quantity: null,
        unitAmount: null,
        amount: Math.round(income.amount * 100) / 100,
        side: 'IN',
      });
    }

    lines.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.reference.localeCompare(b.reference));

    revenue = Math.round(revenue * 100) / 100;
    cogs = Math.round(cogs * 100) / 100;
    expenseTotal = Math.round(expenseTotal * 100) / 100;
    incomeTotal = Math.round(incomeTotal * 100) / 100;
    const grossProfit = Math.round((revenue - cogs) * 100) / 100;
    const netProfit = Math.round((revenue - cogs - expenseTotal + incomeTotal) * 100) / 100;

    return {
      salesTotal: sales.total,
      purchasesTotal: purchases.total,
      grossProfit: sales.total - purchases.total,
      salesCount: sales.count,
      purchasesCount: purchases.count,
      revenue,
      cogs,
      expenses: expenseTotal,
      incomes: incomeTotal,
      operatingProfit: grossProfit,
      netProfit,
      lines,
      counts: {
        revenue: lines.filter((row) => row.kind === 'REVENUE' || row.kind === 'TAX').length,
        returns: lines.filter((row) => row.kind === 'RETURN').length,
        cogs: lines.filter((row) => row.kind === 'COGS').length,
        expenses: lines.filter((row) => row.kind === 'EXPENSE').length,
        incomes: lines.filter((row) => row.kind === 'INCOME').length,
        all: lines.length,
      },
    };
  }

  async productInsights(from?: string, to?: string, warehouseIds?: string[]) {
    const invoiceDate = this.dayRange(from, to);
    const confirmed = { in: [InvoiceStatus.CONFIRMED, InvoiceStatus.PARTIAL, InvoiceStatus.PAID] };
    const warehouse = warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {};

    const [saleLines, saleReturnLines, purchaseLines, purchaseReturnLines, products] = await Promise.all([
      this.prisma.salesInvoiceLine.findMany({
        where: { invoice: { status: confirmed, ...warehouse, ...(invoiceDate ? { invoiceDate } : {}) } },
        include: { product: true },
      }),
      this.prisma.salesReturnLine.findMany({
        where: { salesReturn: { ...warehouse, ...(invoiceDate ? { returnDate: invoiceDate } : {}) } },
        include: { product: true },
      }),
      this.prisma.purchaseInvoiceLine.findMany({
        where: { invoice: { status: confirmed, ...warehouse, ...(invoiceDate ? { invoiceDate } : {}) } },
        include: { product: true },
      }),
      this.prisma.purchaseReturnLine.findMany({
        where: { purchaseReturn: { ...warehouse, ...(invoiceDate ? { returnDate: invoiceDate } : {}) } },
        include: { product: true },
      }),
      this.prisma.product.findMany({
        where: { isActive: true },
        include: { stockBalances: warehouseIds?.length ? { where: { warehouseId: { in: warehouseIds } } } : true },
      }),
    ]);

    type Info = {
      productId: string;
      sku: string;
      name: string;
      unit: string;
      costPrice: number;
      salePrice: number;
      stockQty: number;
    };
    const info = new Map<string, Info>();
    const remember = (product: { id: string; sku: string; name: string; unit: string; costPrice: number; salePrice: number }, stockQty = 0) => {
      if (!info.has(product.id)) {
        info.set(product.id, {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          costPrice: product.costPrice,
          salePrice: product.salePrice,
          stockQty,
        });
      }
    };
    for (const product of products) {
      remember(product, product.stockBalances.reduce((sum, row) => sum + row.quantity, 0));
    }
    for (const line of saleLines) remember(line.product);
    for (const line of saleReturnLines) remember(line.product);
    for (const line of purchaseLines) remember(line.product);
    for (const line of purchaseReturnLines) remember(line.product);

    const sold = new Map<string, { qty: number; amount: number }>();
    const purchased = new Map<string, { qty: number; amount: number }>();
    const add = (map: Map<string, { qty: number; amount: number }>, productId: string, qty: number, amount: number) => {
      const current = map.get(productId) || { qty: 0, amount: 0 };
      current.qty += qty;
      current.amount += amount;
      map.set(productId, current);
    };
    for (const line of saleLines) add(sold, line.productId, line.quantity, line.total);
    for (const line of saleReturnLines) add(sold, line.productId, -line.quantity, -line.total);
    for (const line of purchaseLines) add(purchased, line.productId, line.quantity, line.total);
    for (const line of purchaseReturnLines) add(purchased, line.productId, -line.quantity, -line.total);

    const topSold = [...sold.entries()]
      .filter(([, row]) => row.qty > 0)
      .map(([productId, row]) => ({ ...info.get(productId)!, quantity: row.qty, amount: row.amount }))
      .sort((a, b) => b.quantity - a.quantity);

    const topPurchased = [...purchased.entries()]
      .filter(([, row]) => row.qty > 0)
      .map(([productId, row]) => ({ ...info.get(productId)!, quantity: row.qty, amount: row.amount }))
      .sort((a, b) => b.quantity - a.quantity);

    const losses = topSold
      .map((row) => {
        const cost = row.quantity * row.costPrice;
        const loss = Math.round((cost - row.amount) * 100) / 100;
        return { ...row, revenue: row.amount, cost, loss };
      })
      .filter((row) => row.loss > 0)
      .sort((a, b) => b.loss - a.loss);

    const lossTotal = Math.round(losses.reduce((sum, row) => sum + row.loss, 0) * 100) / 100;

    const underpriced = [...info.values()]
      .filter((row) => row.stockQty > 0 && row.salePrice > 0 && row.costPrice > row.salePrice)
      .map((row) => ({
        ...row,
        gap: row.costPrice - row.salePrice,
        potentialLoss: Math.round(row.stockQty * (row.costPrice - row.salePrice) * 100) / 100,
      }))
      .sort((a, b) => b.potentialLoss - a.potentialLoss);

    const potentialLossTotal = Math.round(underpriced.reduce((sum, row) => sum + row.potentialLoss, 0) * 100) / 100;

    const unsold = [...info.values()]
      .filter((row) => {
        const soldQty = sold.get(row.productId)?.qty || 0;
        const purchasedQty = purchased.get(row.productId)?.qty || 0;
        return soldQty <= 0 && (row.stockQty > 0 || purchasedQty > 0);
      })
      .map((row) => ({
        ...row,
        purchasedQty: Math.max(0, purchased.get(row.productId)?.qty || 0),
        stockValue: Math.round(row.stockQty * row.costPrice * 100) / 100,
      }))
      .sort((a, b) => b.stockValue - a.stockValue);

    const unsoldValue = Math.round(unsold.reduce((sum, row) => sum + row.stockValue, 0) * 100) / 100;

    return {
      topSold,
      topPurchased,
      losses,
      lossTotal,
      underpriced,
      potentialLossTotal,
      unsold,
      unsoldValue,
    };
  }

  private dayRange(from?: string, to?: string) {
    if (!from && !to) return undefined;
    return {
      ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
    };
  }

  async cashReport(from?: string, to?: string, warehouseIds?: string[]) {
    const createdAt = this.dayRange(from, to);
    let references: string[] | undefined;
    if (warehouseIds?.length) {
      const [receipts, payments] = await Promise.all([
        this.prisma.receipt.findMany({
          where: { salesInvoice: { warehouseId: { in: warehouseIds } } },
          select: { number: true },
        }),
        this.prisma.payment.findMany({
          where: { purchaseInvoice: { warehouseId: { in: warehouseIds } } },
          select: { number: true },
        }),
      ]);
      references = [...receipts, ...payments].map((row) => row.number);
      if (!references.length) {
        return { transactions: [], accounts: [], totalIn: 0, totalOut: 0, net: 0 };
      }
    }
    const where = {
      ...(createdAt ? { createdAt } : {}),
      ...(references ? { reference: { in: references } } : {}),
    };
    const transactions = await this.prisma.cashTransaction.findMany({
      where,
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });
    const accounts = await this.prisma.cashAccount.findMany();
    const totalIn = transactions.filter((t) => t.direction === 'IN').reduce((s, t) => s + t.amount, 0);
    const totalOut = transactions.filter((t) => t.direction === 'OUT').reduce((s, t) => s + t.amount, 0);
    return { transactions, accounts, totalIn, totalOut, net: totalIn - totalOut };
  }

  async customersReport() {
    const customers = await this.prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true, phone: true, balance: true,
        _count: { select: { salesInvoices: true, receipts: true } },
      },
    });
    const due = customers.filter((c) => c.balance > 0.009);
    const prepaid = customers.filter((c) => c.balance < -0.009);
    return {
      customers,
      totalDue: due.reduce((s, c) => s + c.balance, 0),
      totalPrepaid: prepaid.reduce((s, c) => s + Math.abs(c.balance), 0),
      dueCount: due.length,
      prepaidCount: prepaid.length,
      count: customers.length,
    };
  }

  async suppliersReport() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true, phone: true, balance: true,
        _count: { select: { purchaseInvoices: true, payments: true } },
      },
    });
    const due = suppliers.filter((s) => s.balance > 0.009);
    const prepaid = suppliers.filter((s) => s.balance < -0.009);
    return {
      suppliers,
      totalDue: due.reduce((s, c) => s + c.balance, 0),
      totalPrepaid: prepaid.reduce((s, c) => s + Math.abs(c.balance), 0),
      dueCount: due.length,
      prepaidCount: prepaid.length,
      count: suppliers.length,
    };
  }

  async financeReport(from?: string, to?: string) {
    const range = this.dayRange(from, to);
    const [expenses, incomes, checks, transfers] = await Promise.all([
      this.prisma.expense.findMany({
        where: range ? { expenseDate: range } : undefined,
        include: { category: true, account: true },
        orderBy: { expenseDate: 'desc' },
      }),
      this.prisma.income.findMany({
        where: range ? { incomeDate: range } : undefined,
        include: { category: true, account: true },
        orderBy: { incomeDate: 'desc' },
      }),
      this.prisma.bankCheck.findMany({
        where: range ? { dueDate: range } : undefined,
        include: { customer: true, supplier: true, account: true },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.cashTransfer.findMany({
        where: range ? { createdAt: range } : undefined,
        include: { fromAccount: true, toAccount: true, createdBy: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
    const incomeTotal = incomes.reduce((s, e) => s + e.amount, 0);
    const byExpense = new Map<string, number>();
    const byIncome = new Map<string, number>();
    for (const row of expenses) byExpense.set(row.category.name, (byExpense.get(row.category.name) || 0) + row.amount);
    for (const row of incomes) byIncome.set(row.category.name, (byIncome.get(row.category.name) || 0) + row.amount);
    return {
      expenses,
      incomes,
      checks,
      transfers,
      expenseTotal,
      incomeTotal,
      net: incomeTotal - expenseTotal,
      transferTotal: transfers.reduce((s, t) => s + t.amount, 0),
      byExpenseCategory: [...byExpense.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      byIncomeCategory: [...byIncome.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      pendingChecks: checks.filter((c) => c.status === 'PENDING').length,
    };
  }

  async hrReport(from?: string, to?: string) {
    const range = this.dayRange(from, to);
    const [employees, attendance, leaves, movements, payroll] = await Promise.all([
      this.prisma.hrEmployee.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true, code: true, name: true, salary: true, commissionPercent: true, phone: true, hireDate: true,
          _count: { select: { attendance: true, leaves: true, movements: true } },
        },
      }),
      this.prisma.hrAttendance.findMany({
        where: range ? { workDate: range } : undefined,
        include: { employee: { select: { code: true, name: true } } },
        orderBy: { workDate: 'desc' },
        take: 500,
      }),
      this.prisma.hrLeave.findMany({
        where: range ? { OR: [{ fromDate: range }, { toDate: range }] } : undefined,
        include: { employee: { select: { code: true, name: true } } },
        orderBy: { fromDate: 'desc' },
        take: 200,
      }),
      this.prisma.hrMovement.findMany({
        where: range ? { movementDate: range } : undefined,
        include: { employee: { select: { code: true, name: true } } },
        orderBy: { movementDate: 'desc' },
        take: 300,
      }),
      this.prisma.hrPayrollRun.findMany({
        where: range ? { createdAt: range } : undefined,
        include: {
          lines: { include: { employee: { select: { code: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const salaryTotal = employees.reduce((s, e) => s + e.salary, 0);
    const overtimeMinutes = attendance.reduce((s, a) => s + (a.overtimeApproved ? a.overtimeMinutes : 0), 0);
    const movementTotal = movements.reduce((s, m) => s + m.amount, 0);
    return {
      employees,
      attendance,
      leaves,
      movements,
      payroll,
      employeeCount: employees.length,
      salaryTotal,
      overtimeMinutes,
      movementTotal,
      leaveCount: leaves.length,
      attendanceCount: attendance.length,
    };
  }

  async productionReport(from?: string, to?: string, warehouseIds?: string[]) {
    const range = this.dayRange(from, to);
    const whFilter = warehouseIds?.length
      ? {
          OR: [
            { rawWarehouseId: { in: warehouseIds } },
            { finishedWarehouseId: { in: warehouseIds } },
          ],
        }
      : {};
    const [orders, jobs] = await Promise.all([
      this.prisma.productionOrder.findMany({
        where: {
          ...(range ? { createdAt: range } : {}),
          ...whFilter,
        },
        include: {
          product: { select: { sku: true, name: true } },
          rawWarehouse: { select: { name: true, code: true } },
          finishedWarehouse: { select: { name: true, code: true } },
          materials: { include: { product: { select: { sku: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      this.prisma.mfgJob.findMany({
        where: {
          ...(range ? { createdAt: range } : {}),
          ...whFilter,
        },
        include: {
          finishedProduct: { select: { sku: true, name: true } },
          rawWarehouse: { select: { name: true, code: true } },
          finishedWarehouse: { select: { name: true, code: true } },
          stages: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    ]);
    const orderCost = orders.reduce((s, o) => s + (o.totalCost || 0), 0);
    const jobCost = jobs.reduce((s, j) => s + (j.totalCost || 0), 0);
    return {
      orders,
      jobs,
      orderCount: orders.length,
      jobCount: jobs.length,
      orderCost,
      jobCost,
      totalCost: orderCost + jobCost,
    };
  }

  async exportInventoryExcel(warehouseIds?: string[]) {
    const rows = await this.inventory(warehouseIds);
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('المخزون');
    ws.columns = [
      { header: 'المخزن', key: 'warehouse', width: 20 },
      { header: 'الكود', key: 'sku', width: 15 },
      { header: 'الصنف', key: 'name', width: 30 },
      { header: 'الوحدة', key: 'unit', width: 10 },
      { header: 'الكمية', key: 'qty', width: 12 },
      { header: 'تكلفة', key: 'cost', width: 12 },
      { header: 'بيع', key: 'sale', width: 12 },
    ];
    for (const r of rows) {
      ws.addRow({
        warehouse: r.warehouse.name,
        sku: r.product.sku,
        name: r.product.name,
        unit: r.product.unit,
        qty: r.quantity,
        cost: r.product.costPrice,
        sale: r.product.salePrice,
      });
    }
    ws.getRow(1).font = { bold: true };
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
