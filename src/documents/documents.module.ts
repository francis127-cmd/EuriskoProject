import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { S3Service } from './s3.service';
import { PrismaService } from '../prisma.service';
import { DepartmentsModule } from '../departments/departments.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DepartmentsModule, AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, S3Service, PrismaService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
