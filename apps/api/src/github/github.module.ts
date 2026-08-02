import { Module } from '@nestjs/common';
import { GitHubController } from './controller';
import { GitHubPublicController } from './public.controller';
import { GitHubService } from './service';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../core/database.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { TaskEventService } from '../resource/task-event.service';

@Module({
  imports: [AuthModule, DatabaseModule, WorkspaceModule],
  controllers: [GitHubPublicController, GitHubController],
  providers: [GitHubService, TaskEventService],
  exports: [GitHubService],
})
export class GitHubModule {}
