import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EmbeddingWorkerModule } from './worker.module';
import { EmbeddingWorkerService } from './worker.service';

async function main() {
  const app = await NestFactory.createApplicationContext(EmbeddingWorkerModule, { logger: ['error', 'warn', 'log'] });
  const worker = app.get(EmbeddingWorkerService);
  worker.assertConfigured();
  const pollMs = environmentInteger('EMBEDDING_WORKER_POLL_MS', 2_000, 250, 60_000);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  Logger.log('Embedding worker started.', 'EmbeddingWorker');
  try {
    while (!stopping) {
      const processed = await worker.runOnce();
      if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    await app.close();
    Logger.log('Embedding worker stopped.', 'EmbeddingWorker');
  }
}

void main().catch((error) => {
  Logger.error(error instanceof Error ? error.message : String(error), undefined, 'EmbeddingWorker');
  process.exitCode = 1;
});

function environmentInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}
