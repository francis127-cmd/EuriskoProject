import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { InfraExceptionFilter } from './common/infra-exception.filter';
import { RequestIdInterceptor } from './common/request-id.interceptor';
import { PinoLoggerService } from './pino-logger.service';

async function bootstrap() {
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, {
    logger: new PinoLoggerService(),
  });

  // CORS: restrict in production, permissive in development
  const allowedOrigins = process.env['CORS_ORIGINS']
    ? process.env['CORS_ORIGINS'].split(',').map((s) => s.trim())
    : ['http://localhost:8081', 'http://localhost:19006']; // Expo dev

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.useGlobalFilters(new InfraExceptionFilter());

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  await app.listen(port);
}
bootstrap();
