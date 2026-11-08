import { Module } from '@nestjs/common';
import { SequenceService } from '../common/sequence.service';
import { PurchasesModule } from '../purchases/purchases.module';
import { SalesModule } from '../sales/sales.module';
import { DeliveryNotesController } from './delivery-notes.controller';
import { DeliveryNotesService } from './delivery-notes.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [SalesModule, PurchasesModule],
  controllers: [DeliveryNotesController, DocumentsController],
  providers: [DocumentsService, DeliveryNotesService, SequenceService],
})
export class DocumentsModule {}
