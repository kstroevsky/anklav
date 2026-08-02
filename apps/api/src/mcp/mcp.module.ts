import { Module } from '@nestjs/common';
import { McpController } from './controller';
import { McpService } from './service';
import { KnowledgeModule } from '../portfolio-knowledge/knowledge.module';
import { OAuthModule } from '../oauth/oauth.module';
import { ResourceModule } from '../resource/resource.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ExecutionModule } from '../execution/execution.module';
import { EvidenceModule } from '../evidence/evidence.module';

@Module({
  imports: [EvidenceModule, ExecutionModule, KnowledgeModule, OAuthModule, ResourceModule, WorkspaceModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
