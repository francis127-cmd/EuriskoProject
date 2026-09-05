import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

const LOCAL_DIR = join(process.cwd(), 'uploads');

@Injectable()
export class S3Service implements OnModuleInit {
  private client: S3Client;
  private bucket: string;
  private useLocal = false;
  private readonly logger = new Logger(S3Service.name);

  onModuleInit() {
    const endpoint = process.env.MINIO_ENDPOINT;
    if (!endpoint) {
      this.useLocal = true;
      if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });
      const docsDir = join(LOCAL_DIR, 'documents');
      if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
      this.logger.log('Using local file storage (no S3 configured)');
      return;
    }

    this.bucket = process.env.MINIO_BUCKET || 'hr-documents';
    this.client = new S3Client({
      endpoint: `http://${endpoint}:${process.env.MINIO_PORT || 9000}`,
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
    if (this.useLocal) {
      const filePath = join(LOCAL_DIR, key);
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, buffer);
      this.logger.debug(`Uploaded locally: ${key} (${buffer.byteLength} bytes)`);
      return;
    }
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    this.logger.debug(`Uploaded: ${key} (${buffer.byteLength} bytes)`);
  }

  async download(key: string): Promise<{ body: Buffer; contentType: string }> {
    if (this.useLocal) {
      const filePath = join(LOCAL_DIR, key);
      if (!existsSync(filePath)) throw new Error('File not found');
      return { body: readFileSync(filePath), contentType: 'application/octet-stream' };
    }
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
    if (this.useLocal) {
      const filePath = join(LOCAL_DIR, key);
      if (existsSync(filePath)) unlinkSync(filePath);
      this.logger.debug(`Deleted locally: ${key}`);
      return;
    }
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    this.logger.debug(`Deleted: ${key}`);
  }
}
