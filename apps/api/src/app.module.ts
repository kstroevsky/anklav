import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { AuthController, AuthService, SessionGuard } from './auth';
import { DatabaseService } from './db/database.service';
import { AccountController, WorkspaceController } from './domain.controllers';
import { ResourceService } from './resource.service';
import { WorkspaceService } from './workspace.service';
import { McpController, McpService } from './mcp';
import { OAuthController, OAuthMetadataController, OAuthService, OAuthSettingsController } from './oauth';

@Module({
  controllers: [AuthController, AccountController, WorkspaceController, OAuthMetadataController, OAuthController, OAuthSettingsController, McpController],
  providers: [DatabaseService, ActivityService, AuthService, SessionGuard, WorkspaceService, ResourceService, OAuthService, McpService],
})
export class AppModule {}
