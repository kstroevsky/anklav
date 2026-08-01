import { Injectable } from '@nestjs/common';
import { ActivityService } from '../activity.service';
import { GitHubService } from '../github';
import { DatabaseService } from '../db/database.service';
import { WorkspaceService } from '../workspace.service';
import { ResourceRelationService } from './relation.service';

@Injectable()
export class ResourceService extends ResourceRelationService {
  constructor(
    database: DatabaseService,
    workspaces: WorkspaceService,
    activityService: ActivityService,
    github: GitHubService,
  ) {
    super(database, workspaces, activityService, github);
  }
}

