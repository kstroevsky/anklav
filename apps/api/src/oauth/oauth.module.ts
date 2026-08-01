import { Module } from '@nestjs/common';
import { OAuthController } from './controller';
import { OAuthMetadataController } from './metadata.controller';
import { OAuthSettingsController } from './settings.controller';
import { OAuthService } from './service';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../core/database.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [AuthModule, DatabaseModule, WorkspaceModule],
  controllers: [OAuthMetadataController, OAuthController, OAuthSettingsController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}

