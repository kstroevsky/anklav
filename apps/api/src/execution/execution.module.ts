import { Module } from '@nestjs/common';
import { DatabaseModule } from '../core/database.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ExecutionController } from './controller';
import { ExecutionService } from './service';

@Module({
  imports: [DatabaseModule, WorkspaceModule],
  controllers: [ExecutionController],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
