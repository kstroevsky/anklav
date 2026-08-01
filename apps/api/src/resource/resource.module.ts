import { Module } from '@nestjs/common';
import { ResourceService } from './service';
import { ActivityModule } from '../core/activity.module';
import { DatabaseModule } from '../core/database.module';
import { GitHubModule } from '../github/github.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [ActivityModule, DatabaseModule, GitHubModule, WorkspaceModule],
  providers: [ResourceService],
  exports: [ResourceService],
})
export class ResourceModule {}

