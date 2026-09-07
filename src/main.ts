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

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.useGlobalFilters(new InfraExceptionFilter());

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  await app.listen(port);
}
bootstrap();
