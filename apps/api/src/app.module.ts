import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { DomainModule } from './domain/domain.module';
import { GitHubModule } from './github/github.module';
import { ImportModule } from './portfolio-import/import.module';
import { KnowledgeModule } from './portfolio-knowledge/knowledge.module';
import { McpModule } from './mcp/mcp.module';
import { OAuthModule } from './oauth/oauth.module';
import { ResourceModule } from './resource/resource.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { ExecutionModule } from './execution/execution.module';
import { EvidenceModule } from './evidence/evidence.module';

@Module({
  imports: [AccountModule, AuthModule, DomainModule, GitHubModule, ImportModule, KnowledgeModule, McpModule, OAuthModule, ResourceModule, WorkspaceModule, ExecutionModule, EvidenceModule],
})
export class AppModule {}
