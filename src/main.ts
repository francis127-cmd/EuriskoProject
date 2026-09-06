import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { InfraExceptionFilter } from './common/infra-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new InfraExceptionFilter());
  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  await app.listen(port);
}
bootstrap();
// redeploy trigger
