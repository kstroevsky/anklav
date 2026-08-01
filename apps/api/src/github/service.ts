import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { WorkspaceService } from '../workspace.service';
import { GitHubWebhookService } from './webhook.service';

@Injectable()
export class GitHubService extends GitHubWebhookService {
  constructor(database: DatabaseService, workspaces: WorkspaceService) {
    super(database, workspaces);
  }
}

