import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerProdOrderStatus } from '@prisma/client';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';

export type ProdOrderLineInput = {
  productId?: string | null;
  description: string;
  width?: number | null;
  thickness?: number | null;
  quantity: number;
  unitPrice?: number | null;
};

const include = {
  customer: { select: { id: true, name: true, code: true, phone: true, address: true } },
  product: { select: { id: true, name: true, sku: true } },
  lines: {
    include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
    orderBy: { sortOrder: 'asc' as const },
  },
};

function optionalNumber(value?: number | null) {
  return value == null || Number.isNaN(Number(value)) ? null : Number(value);
}

@Injectable()
export class ProdOrdersService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  list() {
    return this.prisma.customerProdOrder.findMany({
      include,
      orderBy: { orderDate: 'desc' },
      take: 300,
    });
  }

  async get(id: string) {
    const row = await this.prisma.customerProdOrder.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException('أوردر الإنتاج غير موجود');
    return row;
  }

  /** Normalises lines; falls back to the single-line header fields for older clients. */
  private normalizeLines(data: {
    lines?: ProdOrderLineInput[];
    description?: string;
    quantity?: number;
    unitPrice?: number;
    productId?: string | null;
  }) {
    const source: ProdOrderLineInput[] = data.lines?.length
      ? data.lines
      : data.description
        ? [{ description: data.description, quantity: Number(data.quantity) || 0, unitPrice: data.unitPrice, productId: data.productId }]
        : [];
    const lines = source.map((line, index) => {
      const description = (line.description || '').trim();
      const quantity = Number(line.quantity) || 0;
      if (description.length < 2) throw new BadRequestException(`اكتب بيان البند ${index + 1}`);
      if (!(quantity > 0)) throw new BadRequestException(`أدخل كمية البند ${index + 1}`);
      return {
        productId: line.productId || null,
        description,
        width: optionalNumber(line.width),
        thickness: optionalNumber(line.thickness),
        quantity,
        unitPrice: Number(line.unitPrice) || 0,
        sortOrder: index,
      };
    });
    if (!lines.length) throw new BadRequestException('أضف بند واحد على الأقل');
    return lines;
  }

  private headerFrom(lines: ReturnType<ProdOrdersService['normalizeLines']>) {
    const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
    const amount = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    return {
      description: lines.map((line) => line.description).join(' + ').slice(0, 500),
      quantity,
      unitPrice: quantity > 0 ? Math.round((amount / quantity) * 10000) / 10000 : 0,
      productId: lines.find((line) => line.productId)?.productId || null,
    };
  }

  async create(data: {
    customerId: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    orderDate?: string;
    deliveryDate?: string;
    notes?: string;
    productId?: string;
    lines?: ProdOrderLineInput[];
    createdById?: string;
  }) {
    if (!data.customerId) throw new BadRequestException('اختر العميل');
    const lines = this.normalizeLines(data);

    const customer = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new BadRequestException('العميل غير موجود');

    const number = await this.sequence.next('prod_orders', 'PO');
    return this.prisma.customerProdOrder.create({
      data: {
        number,
        customerId: data.customerId,
        ...this.headerFrom(lines),
        orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        notes: data.notes?.trim() || null,
        status: CustomerProdOrderStatus.CONFIRMED,
        createdById: data.createdById || null,
        lines: { create: lines },
      },
      include,
    });
  }

  async update(id: string, data: {
    customerId?: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    orderDate?: string;
    deliveryDate?: string | null;
    notes?: string | null;
    productId?: string | null;
    status?: CustomerProdOrderStatus;
    lines?: ProdOrderLineInput[];
  }) {
    const existing = await this.get(id);
    if (existing.status === CustomerProdOrderStatus.CANCELLED && data.status !== CustomerProdOrderStatus.CANCELLED) {
      throw new BadRequestException('الأوردر ملغى');
    }
    const lines = data.lines ? this.normalizeLines({ lines: data.lines }) : null;
    return this.prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.customerProdOrderLine.deleteMany({ where: { orderId: id } });
        await tx.customerProdOrderLine.createMany({ data: lines.map((line) => ({ ...line, orderId: id })) });
      }
      return tx.customerProdOrder.update({
        where: { id },
        data: {
          customerId: data.customerId ?? undefined,
          ...(lines
            ? this.headerFrom(lines)
            : {
                description: data.description?.trim() || undefined,
                quantity: data.quantity != null ? Number(data.quantity) : undefined,
                unitPrice: data.unitPrice != null ? Number(data.unitPrice) : undefined,
                productId: data.productId === undefined ? undefined : data.productId,
              }),
          orderDate: data.orderDate ? new Date(data.orderDate) : undefined,
          deliveryDate: data.deliveryDate === null ? null : data.deliveryDate ? new Date(data.deliveryDate) : undefined,
          notes: data.notes === undefined ? undefined : (data.notes?.trim() || null),
          status: data.status,
        },
        include,
      });
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.customerProdOrder.delete({ where: { id } });
    return { ok: true };
  }
}
