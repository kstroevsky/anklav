import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { AuthController, AuthService, SessionGuard } from './auth';
import { DatabaseService } from './db/database.service';
import { AccountController, WorkspaceController } from './domain.controllers';
import { ResourceService } from './resource.service';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [AuthController, AccountController, WorkspaceController],
  providers: [DatabaseService, ActivityService, AuthService, SessionGuard, WorkspaceService, ResourceService],
})
export class AppModule {}
