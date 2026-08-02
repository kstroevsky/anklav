import { Module } from '@nestjs/common';
import { DatabaseModule } from '../core/database.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { EvidenceController } from './controller';
import { EvidenceService } from './service';
import { EvidenceStorageService } from './storage.service';

@Module({
  imports: [DatabaseModule, WorkspaceModule],
  controllers: [EvidenceController],
  providers: [EvidenceService, EvidenceStorageService],
  exports: [EvidenceService],
})
export class EvidenceModule {}
