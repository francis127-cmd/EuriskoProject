import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    // Endpoint may be a full URL (e.g. Cloudflare R2:
    // https://<account-id>.r2.cloudflarestorage.com) or a MinIO host.
    // MINIO_USE_SSL / MINIO_FORCE_PATH_STYLE only apply to the host form.
    const endpoint = process.env['MINIO_ENDPOINT'] || 'localhost';
    const fullUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const useSsl = process.env['MINIO_USE_SSL'] === 'true';
    this.client = new S3Client({
      endpoint: fullUrl ? endpoint : `${useSsl ? 'https' : 'http'}://${endpoint}:${process.env['MINIO_PORT'] || '9000'}`,
      region: process.env['AWS_REGION'] || 'us-east-1',
      forcePathStyle: process.env['MINIO_FORCE_PATH_STYLE'] !== 'false',
      credentials: {
        accessKeyId: process.env['MINIO_ACCESS_KEY'] || 'minioadmin',
        secretAccessKey: process.env['MINIO_SECRET_KEY'] || 'minioadmin',
      },
    });
    this.bucket = process.env['MINIO_BUCKET'] || 'hr-documents';
  }

  async upload(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    this.logger.log(`Uploaded ${key} (${body.byteLength} bytes)`);
  }

  async download(key: string) {
    const resp = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    const stream = resp.Body as AsyncIterable<Uint8Array>;
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    return { body, contentType: resp.ContentType || 'application/octet-stream' };
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    this.logger.log(`Deleted ${key}`);
  }
}
