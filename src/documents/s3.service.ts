import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service implements OnModuleInit {
  private client: S3Client;
  private bucket: string;
  private readonly logger = new Logger(S3Service.name);

  onModuleInit() {
    this.bucket = process.env.MINIO_BUCKET || 'hr-documents';
    this.client = new S3Client({
      endpoint: `http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || 9000}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      },
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.logger.log(`S3 configured: bucket=${this.bucket}`);
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    this.logger.debug(`Uploaded: ${key} (${buffer.byteLength} bytes)`);
  }

  async download(key: string): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    const chunks: Uint8Array[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(chunk);
    return {
      body: Buffer.concat(chunks),
      contentType: res.ContentType || 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    this.logger.debug(`Deleted: ${key}`);
  }
}
