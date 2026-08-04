import { Module } from '@nestjs/common';
import { DatabaseModule } from '../core/database.module';
import { EMBEDDING_PROVIDER, OpenAiCompatibleEmbeddingProvider } from './embedding-provider';
import { EmbeddingWorkerService } from './worker.service';

@Module({
  imports: [DatabaseModule],
  providers: [OpenAiCompatibleEmbeddingProvider, { provide: EMBEDDING_PROVIDER, useExisting: OpenAiCompatibleEmbeddingProvider }, EmbeddingWorkerService],
  exports: [EmbeddingWorkerService],
})
export class EmbeddingWorkerModule {}
