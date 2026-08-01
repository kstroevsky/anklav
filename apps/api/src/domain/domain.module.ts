import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { AuthModule } from '../auth/auth.module';
import { ResourceModule } from '../resource/resource.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [AuthModule, ResourceModule, WorkspaceModule],
  controllers: [WorkspaceController],
})
export class DomainModule {}

