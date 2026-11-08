import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';
import { pageResult, readPage } from '../common/paging';

export type DeliveryLineInput = { description: string; quantity?: number | null; weight?: number | null };

const include = {
  customer: { select: { id: true, code: true, name: true, phone: true, address: true } },
  salesInvoice: { select: { id: true, number: true } },
  lines: { orderBy: { sortOrder: 'asc' as const } },
};

function optionalNumber(value?: number | null) {
  return value == null || Number.isNaN(Number(value)) ? null : Number(value);
}

@Injectable()
export class DeliveryNotesService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  async list(query?: { q?: string; page?: string; pageSize?: string }) {
    const q = query?.q?.trim();
    const where: Prisma.DeliveryNoteWhereInput = q
      ? {
          OR: [
            { number: { contains: q } },
            { recipientName: { contains: q } },
            { customer: { name: { contains: q } } },
            { salesInvoice: { number: { contains: q } } },
          ],
        }
      : {};
    const page = readPage(query);
    if (!page) return this.prisma.deliveryNote.findMany({ where, include, orderBy: { noteDate: 'desc' }, take: 300 });
    const [total, items] = await Promise.all([
      this.prisma.deliveryNote.count({ where }),
      this.prisma.deliveryNote.findMany({ where, include, orderBy: { noteDate: 'desc' }, skip: page.skip, take: page.take }),
    ]);
    return pageResult(items, total, page);
  }

  async get(id: string) {
    const row = await this.prisma.deliveryNote.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException('إذن التسليم غير موجود');
    return row;
  }

  /** Suggested note content from a sales invoice: customer + one line per invoice line. */
  async fromInvoice(invoiceId: string) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id: invoiceId },
      include: { customer: true, lines: { include: { product: true } } },
    });
    if (!invoice) throw new NotFoundException('الفاتورة غير موجودة');
    return {
      salesInvoiceId: invoice.id,
      salesInvoiceNumber: invoice.number,
      customerId: invoice.customerId,
      recipientName: invoice.customer.name,
      lines: invoice.lines.map((line) => {
        const size = line.width != null || line.thickness != null
          ? ` (${line.width ?? '—'} × ${line.thickness ?? '—'} سم)`
          : '';
        return {
          description: `${line.product.name}${size}`,
          quantity: line.quantity,
          weight: line.netWeight,
        };
      }),
    };
  }

  async create(data: {
    recipientName?: string;
    customerId?: string;
    salesInvoiceId?: string;
    noteDate?: string;
    deliveredBy?: string;
    notes?: string;
    lines: DeliveryLineInput[];
    createdById?: string;
  }) {
    let recipientName = data.recipientName?.trim() || '';
    if (data.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) throw new BadRequestException('العميل غير موجود');
      if (!recipientName) recipientName = customer.name;
    }
    if (!recipientName) throw new BadRequestException('اكتب اسم المستلم (تم تسليم السيد)');
    if (data.salesInvoiceId) {
      const invoice = await this.prisma.salesInvoice.findUnique({ where: { id: data.salesInvoiceId } });
      if (!invoice) throw new BadRequestException('الفاتورة غير موجودة');
    }
    const lines = (data.lines || [])
      .map((line, index) => ({
        description: (line.description || '').trim(),
        quantity: optionalNumber(line.quantity),
        weight: optionalNumber(line.weight),
        sortOrder: index,
      }))
      .filter((line) => line.description);
    if (!lines.length) throw new BadRequestException('أضف بند واحد على الأقل (البيان)');

    const number = await this.sequence.next('delivery_notes', 'DN');
    return this.prisma.deliveryNote.create({
      data: {
        number,
        recipientName,
        customerId: data.customerId || null,
        salesInvoiceId: data.salesInvoiceId || null,
        noteDate: data.noteDate ? new Date(data.noteDate) : new Date(),
        deliveredBy: data.deliveredBy?.trim() || null,
        notes: data.notes?.trim() || null,
        createdById: data.createdById || null,
        lines: { create: lines },
      },
      include,
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.deliveryNote.delete({ where: { id } });
    return { ok: true };
  }
}
