import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { S3Service } from '../documents/s3.service';
import { AdminPrismaService } from '../admin-prisma.service';

@Module({
  providers: [RetentionService, AdminPrismaService, S3Service],
})
export class RetentionModule {}
