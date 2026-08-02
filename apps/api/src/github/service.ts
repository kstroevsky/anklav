import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { WorkspaceService } from '../workspace.service';
import { GitHubWebhookService } from './webhook.service';
import { TaskEventService } from '../resource/task-event.service';

@Injectable()
export class GitHubService extends GitHubWebhookService {
  constructor(database: DatabaseService, workspaces: WorkspaceService, taskEvents: TaskEventService) {
    super(database, workspaces, taskEvents);
  }
}
