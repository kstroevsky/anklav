import { Module } from '@nestjs/common';
import { PortfolioImportController } from './controller';
import { PortfolioImportService } from './service';
import { ActivityModule } from '../core/activity.module';
import { DatabaseModule } from '../core/database.module';
import { KnowledgeModule } from '../portfolio-knowledge/knowledge.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [ActivityModule, DatabaseModule, KnowledgeModule, WorkspaceModule],
  controllers: [PortfolioImportController],
  providers: [PortfolioImportService],
  exports: [PortfolioImportService],
})
export class ImportModule {}
