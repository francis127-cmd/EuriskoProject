import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { PrismaService } from '../prisma.service';
import { S3Service } from '../documents/s3.service';

@Module({
  providers: [RetentionService, PrismaService, S3Service],
  exports: [RetentionService],
})
export class RetentionModule {}
