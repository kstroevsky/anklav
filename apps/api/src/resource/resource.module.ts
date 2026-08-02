import { Module } from '@nestjs/common';
import { ResourceService } from './service';
import { ActivityModule } from '../core/activity.module';
import { DatabaseModule } from '../core/database.module';
import { GitHubModule } from '../github/github.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { TaskEventService } from './task-event.service';

@Module({
  imports: [ActivityModule, DatabaseModule, GitHubModule, WorkspaceModule],
  providers: [ResourceService, TaskEventService],
  exports: [ResourceService, TaskEventService],
})
export class ResourceModule {}
