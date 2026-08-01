import { Injectable } from '@nestjs/common';
import { ActivityService } from '../activity.service';
import { DatabaseService } from '../db/database.service';
import { PortfolioKnowledgeService } from '../portfolio-knowledge.service';
import { PortfolioImportVerificationService } from './verification.service';
import { WorkspaceService } from '../workspace.service';

@Injectable()
export class PortfolioImportService extends PortfolioImportVerificationService {
  constructor(
    database: DatabaseService,
    activity: ActivityService,
    knowledge: PortfolioKnowledgeService,
  ) {
    super(database, activity, knowledge);
  }
}

export * from './types';
export { importPreflight } from './preflight';
