import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Role } from '@prisma/client';
import { Roles } from '../common/guards';
import { DeliveryNotesService } from './delivery-notes.service';

class DeliveryLineDto {
  @IsString() description!: string;
  @IsOptional() @IsNumber() quantity?: number | null;
  @IsOptional() @IsNumber() weight?: number | null;
}

class CreateDeliveryNoteDto {
  @IsOptional() @IsString() recipientName?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() salesInvoiceId?: string;
  @IsOptional() @IsString() noteDate?: string;
  @IsOptional() @IsString() deliveredBy?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DeliveryLineDto)
  lines!: DeliveryLineDto[];
}

@Controller('documents/delivery-notes')
@Roles(Role.ADMIN, Role.ACCOUNTANT, Role.SALES, Role.WAREHOUSE)
export class DeliveryNotesController {
  constructor(private service: DeliveryNotesService) {}

  @Get()
  list(@Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.list({ q, page, pageSize });
  }

  @Get('from-invoice/:invoiceId')
  fromInvoice(@Param('invoiceId') invoiceId: string) {
    return this.service.fromInvoice(invoiceId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() dto: CreateDeliveryNoteDto, @Req() req: { user: { userId: string } }) {
    return this.service.create({ ...dto, createdById: req.user.userId });
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
