import { Module } from '@nestjs/common';
import { WorkspaceService } from './service';
import { ActivityModule } from '../core/activity.module';
import { DatabaseModule } from '../core/database.module';

@Module({
  imports: [DatabaseModule, ActivityModule],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
