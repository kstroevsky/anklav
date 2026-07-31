import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/http';

export async function createApplication(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), { bufferLogs: true });
  await app.register(cookie as any);
  await app.register(helmet as any, { contentSecurityPolicy: false });
  await app.register(rateLimit as any, { global: false });
  app.enableCors({ origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', credentials: true });
  app.useGlobalFilters(new ProblemDetailsFilter());
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Anklav API').setVersion('v1').addCookieAuth('anklav_session').build());
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/openapi.json' });
  return app;
}

async function bootstrap() {
  const app = await createApplication();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`Anklav API listening on ${port}`, 'Bootstrap');
}

if (require.main === module) void bootstrap();
