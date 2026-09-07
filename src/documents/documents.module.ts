import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { S3Service } from './s3.service';
import { DepartmentsModule } from '../departments/departments.module';
import { ScopedPrismaService } from '../scoped-prisma.service';

@Module({
  imports: [DepartmentsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, S3Service, ScopedPrismaService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
