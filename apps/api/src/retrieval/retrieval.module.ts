import { Module } from '@nestjs/common';
import { DatabaseModule } from '../core/database.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { RetrievalController } from './controller';
import { EMBEDDING_PROVIDER, OpenAiCompatibleEmbeddingProvider } from './embedding-provider';
import { RetrievalService } from './service';

@Module({
  imports: [DatabaseModule, WorkspaceModule],
  controllers: [RetrievalController],
  providers: [OpenAiCompatibleEmbeddingProvider, { provide: EMBEDDING_PROVIDER, useExisting: OpenAiCompatibleEmbeddingProvider }, RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
