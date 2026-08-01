import { Module } from '@nestjs/common';
import { PortfolioKnowledgeController } from './controller';
import { PortfolioKnowledgeService } from './service';
import { ActivityModule } from '../core/activity.module';
import { DatabaseModule } from '../core/database.module';
import { GitHubModule } from '../github/github.module';
import { ResourceModule } from '../resource/resource.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [ActivityModule, DatabaseModule, GitHubModule, ResourceModule, WorkspaceModule],
  controllers: [PortfolioKnowledgeController],
  providers: [PortfolioKnowledgeService],
  exports: [PortfolioKnowledgeService],
})
export class KnowledgeModule {}
