import { Module } from '@nestjs/common';
import { DatabaseModule } from '../core/database.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { RetrievalController } from './controller';
import { RetrievalService } from './service';

@Module({ imports: [DatabaseModule, WorkspaceModule], controllers: [RetrievalController], providers: [RetrievalService], exports: [RetrievalService] })
export class RetrievalModule {}
