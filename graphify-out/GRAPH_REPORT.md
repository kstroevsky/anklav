# Graph Report - .  (2026-08-02)

## Corpus Check
- 214 files · ~77,412 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1414 nodes · 4724 edges · 65 communities (50 shown, 15 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.85)
- Token cost: 12,096 input · 7,420 output

## Community Hubs (Navigation)
- Domain State Model
- Web API Client
- Database Schema Utilities
- Account Administration
- GitHub Work Service
- GitHub API Controller
- MCP CLI Runtime
- Knowledge Artifacts
- NestJS Application Modules
- Authentication API
- System Architecture
- Migration Data Model
- Import Apply Pipeline
- OAuth Persistence
- Migration Bundle Validation
- OAuth Authorization Service
- MCP Response Handling
- Migration Control API
- MCP Package
- Web TypeScript Config
- Database Lifecycle
- API Runtime Dependencies
- API TypeScript Config
- Monorepo Tooling
- API Development Tooling
- OAuth Protocol API
- Web Runtime Dependencies
- Web Development Tooling
- Import Target Mapping
- OAuth Grant Settings
- MCP TypeScript Config
- Vite Node Config
- OpenAPI Client Generation
- API Build Scripts
- Migration Import CLI
- MCP Service Resources
- OAuth Metadata Endpoints
- Web Package Scripts
- Shared TypeScript Standards
- Generated OpenAPI Schema
- OAuth URL Metadata
- Docker Runtime Stack
- NestJS CLI Config
- Database Package Metadata
- Brand Identity
- Continuous Integration
- Web Application Shell
- Fastify Cookie Plugin
- Fastify Rate Limiting
- Fastify Raw Body
- Fastify Static Assets
- NestJS Common Dependency
- NestJS Core Dependency
- PostgreSQL Driver
- Reactive Streams
- Application Tests
- React Runtime
- React Form Handling
- React Query State
- TypeScript Compiler
- pnpm Workspace

## God Nodes (most connected - your core abstractions)
1. `AuthUser` - 128 edges
2. `AuthedRequest` - 117 edges
3. `api()` - 64 edges
4. `parseBody()` - 63 edges
5. `ResourceService` - 55 edges
6. `WorkspaceController` - 53 edges
7. `GitHubService` - 49 edges
8. `user()` - 48 edges
9. `WorkspaceService` - 48 edges
10. `DatabaseService` - 46 edges

## Surprising Connections (you probably didn't know these)
- `Self-hosting Boundary` --semantically_similar_to--> `Self-hosted Deployment`  [INFERRED] [semantically similar]
  docs/architecture.md → README.md
- `MCP Access for Coding Agents` --references--> `Anklav MCP`  [INFERRED]
  README.md → docs/mcp.md
- `id()` --indirect_call--> `uuidv7()`  [INFERRED]
  apps/api/src/db/schema/common.ts → apps/api/src/common/ids.ts
- `Anklav` --references--> `Anklav Architecture`  [EXTRACTED]
  README.md → docs/architecture.md
- `Guarded Project-control Migration` --references--> `Project-control Migration Safety Gate`  [EXTRACTED]
  README.md → docs/migration-anklav.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Core Work Model Triad** — docs_initial_project, docs_initial_flow, docs_initial_task [EXTRACTED 1.00]
- **Single-machine Runtime Topology** — docker_compose_postgres_service, docker_compose_migrate_service, docker_compose_api_service, docker_compose_web_service [EXTRACTED 1.00]
- **Migration Safety and Verification Flow** — docs_migration_anklav_immutable_bundle, docs_migration_anklav_explicit_override_decisions, docs_migration_anklav_execution_identity, docs_migration_anklav_verification_report, docs_migration_anklav_guarded_rollback [EXTRACTED 1.00]
- **Anklav Brand Mark Composition** — apps_web_public_anklav_mark_stylized_n_monogram, apps_web_public_anklav_mark_dark_rounded_square_tile, apps_web_public_anklav_mark_cyan_accent_dot [INFERRED 0.95]

## Communities (65 total, 15 thin omitted)

### Community 0 - "Domain State Model"
Cohesion: 0.06
Nodes (86): DEFAULT_FLOW_STATES, DEFAULT_TASK_STATES, FlowSemantic, flowSemantics, healthStates, priorities, projectStatuses, TaskSemantic (+78 more)

### Community 1 - "Web API Client"
Cohesion: 0.08
Nodes (67): api(), ApiError, Flow, mutation(), Page, Project, setCsrfToken(), Task (+59 more)

### Community 2 - "Database Schema Utilities"
Cohesion: 0.07
Nodes (43): slugify(), uuidv7(), workspaceMemberships, githubConnections, githubIssueLinks, githubOauthStates, githubPullRequests, githubRepositories (+35 more)

### Community 3 - "Account Administration"
Cohesion: 0.12
Nodes (31): AuthedRequest, parseBody(), AccountController, Body, Controller, Get, Param, Patch (+23 more)

### Community 4 - "GitHub Work Service"
Cohesion: 0.06
Nodes (10): AuthUser, GitHubWorkService, PortfolioArtifactService, PortfolioMilestoneService, MilestoneInput, ResourceCollaborationService, ResourceRelationService, pick() (+2 more)

### Community 5 - "GitHub API Controller"
Cohesion: 0.10
Nodes (20): GitHubController, Body, Controller, Get, Param, Patch, Post, Query (+12 more)

### Community 6 - "MCP CLI Runtime"
Cohesion: 0.08
Nodes (23): runCli(), assertCallback(), runLogin(), runLogout(), runStdio(), isLoopback(), normalizeOrigin(), Credentials (+15 more)

### Community 7 - "Knowledge Artifacts"
Cohesion: 0.11
Nodes (31): artifactDispositionInput, artifactInput, artifactRelationInput, artifactRevisionInput, contextPackQuery, milestoneInput, PortfolioKnowledgeController, Body (+23 more)

### Community 8 - "NestJS Application Modules"
Cohesion: 0.11
Nodes (31): AccountModule, Module, AppModule, Module, AuthModule, Module, ProblemDetailsFilter, ActivityModule (+23 more)

### Community 9 - "Authentication API"
Cohesion: 0.10
Nodes (15): AuthController, Body, Controller, Get, Patch, Post, Req, Res (+7 more)

### Community 10 - "System Architecture"
Cohesion: 0.05
Nodes (44): Anklav Architecture, API Container, Optional GitHub Integration Boundary, Immutable Activity History, Local Authentication Boundary, OAuth-protected MCP Boundary, If-Match Optimistic Concurrency, PostgreSQL Source of Truth (+36 more)

### Community 11 - "Migration Data Model"
Cohesion: 0.23
Nodes (24): externalObjectMappings, externalSources, importBatches, importConflicts, importCreatedObjects, importVerificationAttempts, importVerifications, githubProjectRepositories (+16 more)

### Community 12 - "Import Apply Pipeline"
Cohesion: 0.15
Nodes (7): MigrationBundle, PortfolioImportApplyService, PortfolioImportBaseService, digest(), ImportOverrides, ImportRequest, PortfolioImportVerificationService

### Community 13 - "OAuth Persistence"
Cohesion: 0.13
Nodes (23): oauthAuthorizationCodes, oauthAuthorizationRequests, oauthGrants, oauthGrantWorkspaces, oauthTokens, Limit, ACCESS_TOKEN_TTL_MS, AUTHORIZATION_CODE_TTL_MS (+15 more)

### Community 14 - "Migration Bundle Validation"
Cohesion: 0.10
Nodes (23): assertChatMetadataHasNoRawContent(), assertNoPotentialCredentials(), boundedRead(), countFiles, credentialPatterns, labelSchema, listFiles(), loadMigrationBundle() (+15 more)

### Community 15 - "OAuth Authorization Service"
Cohesion: 0.14
Nodes (10): All, Req, Res, OAuthService, Injectable, hashToken(), opaqueToken(), redirectWith() (+2 more)

### Community 16 - "MCP Response Handling"
Cohesion: 0.15
Nodes (17): McpController, Controller, failure(), mapError(), success(), warningsMatch(), anyOutput, id (+9 more)

### Community 17 - "Migration Control API"
Cohesion: 0.22
Nodes (13): overrides, PortfolioImportController, Body, Controller, Get, Param, Post, Query (+5 more)

### Community 18 - "MCP Package"
Cohesion: 0.08
Nodes (23): bin, anklav-mcp, dependencies, @modelcontextprotocol/sdk, devDependencies, tsx, @types/node, typescript (+15 more)

### Community 19 - "Web TypeScript Config"
Cohesion: 0.09
Nodes (22): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, isolatedModules, jsx, lib, module (+14 more)

### Community 20 - "Database Lifecycle"
Cohesion: 0.13
Nodes (9): ActivityService, Injectable, DatabaseService, Injectable, run(), hashKey(), sha(), validOverrides (+1 more)

### Community 21 - "API Runtime Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, argon2, drizzle-orm, fastify, @fastify/helmet, @modelcontextprotocol/sdk, @nestjs/platform-fastify, @nestjs/swagger (+11 more)

### Community 22 - "API TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, incremental, module, moduleResolution (+10 more)

### Community 23 - "Monorepo Tooling"
Cohesion: 0.11
Nodes (17): devDependencies, @playwright/test, prettier, name, packageManager, private, scripts, build (+9 more)

### Community 24 - "API Development Tooling"
Cohesion: 0.12
Nodes (17): devDependencies, drizzle-kit, @nestjs/cli, @nestjs/testing, tsx, @types/node, @types/pg, typescript (+9 more)

### Community 25 - "OAuth Protocol API"
Cohesion: 0.19
Nodes (10): oauthClients, OAuthController, Body, Controller, Get, Post, Query, Req (+2 more)

### Community 26 - "Web Runtime Dependencies"
Cohesion: 0.12
Nodes (17): dependencies, clsx, dompurify, @hookform/resolvers, marked, react-dom, react-router-dom, workbox-window (+9 more)

### Community 27 - "Web Development Tooling"
Cohesion: 0.12
Nodes (17): devDependencies, @types/dompurify, @types/node, @types/react, @types/react-dom, vite, vite-plugin-pwa, @vitejs/plugin-react (+9 more)

### Community 28 - "Import Target Mapping"
Cohesion: 0.46
Nodes (6): BundleRecord, PortfolioImportTargetService, ImportContext, normalized(), ResolvedTarget, source()

### Community 29 - "OAuth Grant Settings"
Cohesion: 0.19
Nodes (9): OAuthSettingsController, Body, Controller, Delete, Get, Param, Post, Req (+1 more)

### Community 30 - "MCP TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, types, extends (+4 more)

### Community 31 - "Vite Node Config"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, module, moduleDetection, moduleResolution, noEmit, tsBuildInfoFile, verbatimModuleSyntax (+4 more)

### Community 32 - "OpenAPI Client Generation"
Cohesion: 0.15
Nodes (12): openapi-fetch, openapi-typescript, dependencies, openapi-fetch, devDependencies, openapi-typescript, name, private (+4 more)

### Community 33 - "API Build Scripts"
Cohesion: 0.17
Nodes (12): scripts, build, db:generate, db:migrate, dev, import:anklav, lint, openapi:write (+4 more)

### Community 34 - "Migration Import CLI"
Cohesion: 0.29
Nodes (4): Flags, importPreflight(), isProjectControlTask(), ProjectControlTaskDisposition

### Community 35 - "MCP Service Resources"
Cohesion: 0.45
Nodes (4): resource(), variable(), McpService, McpPrincipal

### Community 36 - "OAuth Metadata Endpoints"
Cohesion: 0.31
Nodes (4): OAuthMetadataController, Controller, Get, Req

### Community 37 - "Web Package Scripts"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, test, version

### Community 38 - "Shared TypeScript Standards"
Cohesion: 0.22
Nodes (8): compilerOptions, forceConsistentCasingInFileNames, noImplicitOverride, noUncheckedIndexedAccess, resolveJsonModule, skipLibCheck, strict, target

### Community 39 - "Generated OpenAPI Schema"
Cohesion: 0.32
Nodes (6): api, components, $defs, operations, paths, webhooks

### Community 41 - "Docker Runtime Stack"
Cohesion: 0.60
Nodes (6): Anklav PostgreSQL Volume, API Service, Local Docker Compose Stack, Database Migration Service, PostgreSQL Service, Web Service

### Community 42 - "NestJS CLI Config"
Cohesion: 0.50
Nodes (3): collection, $schema, sourceRoot

### Community 43 - "Database Package Metadata"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 44 - "Brand Identity"
Cohesion: 0.67
Nodes (4): Anklav Brand Mark, Cyan Accent Dot, Dark Rounded Square Tile, Stylized N Monogram

### Community 45 - "Continuous Integration"
Cohesion: 0.67
Nodes (3): Generated API Contract Check, CI PostgreSQL Service, CI Verify Pipeline

### Community 46 - "Web Application Shell"
Cohesion: 0.67
Nodes (3): Anklav Web App Shell, Main TSX Entrypoint, React Root Mount Point

## Knowledge Gaps
- **224 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `name`, `version` (+219 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AuthUser` connect `GitHub Work Service` to `Domain State Model`, `Database Schema Utilities`, `Account Administration`, `Migration Import CLI`, `MCP Service Resources`, `Knowledge Artifacts`, `Authentication API`, `Migration Data Model`, `Import Apply Pipeline`, `OAuth Persistence`, `OAuth Authorization Service`, `Migration Control API`, `Database Lifecycle`, `OAuth Grant Settings`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `AuthedRequest` connect `Account Administration` to `Domain State Model`, `Database Schema Utilities`, `GitHub API Controller`, `Knowledge Artifacts`, `Authentication API`, `Migration Control API`, `OAuth Grant Settings`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `GitHubService` connect `GitHub API Controller` to `Domain State Model`, `Database Schema Utilities`, `GitHub Work Service`, `NestJS Application Modules`, `Authentication API`, `Migration Data Model`, `Database Lifecycle`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _224 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Domain State Model` be split into smaller, more focused modules?**
  _Cohesion score 0.062134764460345854 - nodes in this community are weakly interconnected._
- **Should `Web API Client` be split into smaller, more focused modules?**
  _Cohesion score 0.07592446892210858 - nodes in this community are weakly interconnected._
- **Should `Database Schema Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.07393939393939394 - nodes in this community are weakly interconnected._