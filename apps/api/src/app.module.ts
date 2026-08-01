import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { AuthController, AuthService, SessionGuard } from './auth';
import { DatabaseService } from './db/database.service';
import { AccountController, WorkspaceController } from './domain.controllers';
import { ResourceService } from './resource.service';
import { WorkspaceService } from './workspace.service';
import { McpController, McpService } from './mcp';
import { OAuthController, OAuthMetadataController, OAuthService, OAuthSettingsController } from './oauth';
import { GitHubController, GitHubPublicController, GitHubService } from './github';
import { PortfolioKnowledgeController } from './portfolio-knowledge.controller';
import { PortfolioKnowledgeService } from './portfolio-knowledge.service';
import { PortfolioImportController } from './portfolio-import.controller';
import { PortfolioImportService } from './portfolio-import.service';

@Module({
  controllers: [AuthController, AccountController, WorkspaceController, OAuthMetadataController, OAuthController, OAuthSettingsController, McpController, GitHubPublicController, GitHubController, PortfolioKnowledgeController, PortfolioImportController],
  providers: [DatabaseService, ActivityService, AuthService, SessionGuard, WorkspaceService, ResourceService, OAuthService, McpService, GitHubService, PortfolioKnowledgeService, PortfolioImportService],
})
export class AppModule {}
