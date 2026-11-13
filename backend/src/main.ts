import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  process.env.TZ = process.env.TZ || 'Asia/Seoul';
  const app = await NestFactory.create(AppModule);
  const origins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim());
  app.enableCors({ origin: origins, credentials: false });
  const port = Number(process.env.PORT || 4000);
  await app.listen(port, '0.0.0.0');
  console.log(`backend listening on :${port}`);
}
bootstrap();
