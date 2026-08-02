import { Module } from '@nestjs/common';
import { McpController } from './controller';
import { McpService } from './service';
import { KnowledgeModule } from '../portfolio-knowledge/knowledge.module';
import { OAuthModule } from '../oauth/oauth.module';
import { ResourceModule } from '../resource/resource.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [ExecutionModule, KnowledgeModule, OAuthModule, ResourceModule, WorkspaceModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
