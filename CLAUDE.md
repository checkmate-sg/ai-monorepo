# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

CheckMate AI is a Cloudflare Workers-based monorepo that provides AI-powered content analysis and moderation services. It uses a microservices architecture where services communicate via Cloudflare service bindings (no network latency).

## Architecture

### Service Flow
```
api-entrypoint (8787)
    ├── agent-service (8788) → Uses tools for analysis
    ├── trivialfilter-service (8794) → Filters low-value submissions
    ├── urlscan-service (8791) → Analyzes URL maliciousness
    ├── embedder-service (8793) → Creates embeddings
    ├── screenshot-service (8789) → Captures screenshots
    ├── screenshot-backup-service (8792) → Backup screenshot service
    └── search-service (8790) → Google search integration
```

### Services Detail

- **api-entrypoint**: Main gateway, routes requests, handles authentication, uses Durable Objects
- **agent-service**: AI orchestration with tools (malicious URL check, image extraction, screenshots, search, translation, reporting)
- **trivialfilter-service**: Filters trivial submissions using LLM
- **urlscan-service**: Analyzes URLs for malicious content
- **embedder-service**: Generates BGE 384-dim embeddings
- **screenshot-service**: Native Cloudflare screenshot capture
- **screenshot-backup-service**: GCP-based screenshot fallback
- **search-service**: Google Custom Search API integration

## Development Setup

### Prerequisites
```bash
npm install -g pnpm
```

### Installation
```bash
pnpm install
# Copy .dev.vars.example to .dev.vars in each worker directory
```

### Running Services

```bash
# Run all services
pnpm dev

# Run specific service
pnpm dev:api-entrypoint
pnpm dev:agent-service
pnpm dev:search-service
# etc.

# Build all
pnpm build

# Lint
pnpm lint
```

## Project Structure

```
/
├── shared/
│   ├── llmClient/        # Shared LLM client (OpenAI, Langfuse)
│   ├── types/           # TypeScript types (@workspace/shared-types)
│   └── utils/           # Utilities (@workspace/shared-utils)
├── workers/
│   ├── api-entrypoint/
│   ├── agent-service/
│   ├── database-service/
│   ├── embedder-service/
│   ├── screenshot-service/
│   ├── screenshot-backup-service/
│   ├── search-service/
│   ├── trivialfilter-service/
│   └── urlscan-service/
├── turbo.json           # Turbo monorepo config
└── package.json         # Root package.json with pnpm workspaces
```

## Deployment

### GitHub Actions
- **On PR to staging**: Deploys to staging environment
- **On PR to main**: Deploys to production environment
- **Manual deployment**: Available through GitHub Actions UI

### Required Secrets
- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`
- `DB_PASSWORD`
- `DB_HOST`
- `DB_USERNAME`
- `GOOGLE_SERVICE_ACCOUNT`
- `LANGFUSE_*` (various Langfuse keys)
- `OPENAI_API_KEY`

### Deployment Command
```bash
pnpm turbo deploy --filter=<worker-name>
```

## Key Data Types

### CheckRequest
```typescript
interface CheckRequest {
  content: string;
  tag?: string;
  parentThreadId?: string;
  sourceApplication?: string;
  sourceMetadata?: Record<string, any>;
  languageHint?: string;
  reportOnly?: boolean;
  submissionId?: string;
  submissionMetadata?: any;
  clientId?: string;
}
```

### CategoryResponse
```typescript
interface CategoryResponse {
  category: "Scam" | "Illicit" | "Info" | "Spam" | "Trivial" | "Irrelevant" | "Error" | string;
  reasoning: string;
  confidence: 0-100;
  additional_info?: {
    harm?: string;
    report?: any;
    trivialReason?: string;
  };
}
```

## Technical Stack

- **Runtime**: Cloudflare Workers (edge computing)
- **Language**: TypeScript
- **AI**: OpenAI API with Langfuse observability
- **Package Manager**: pnpm with workspaces
- **Build**: Turbo for monorepo orchestration
- **Deploy**: Wrangler (Cloudflare CLI)
- **Storage**: Cloudflare KV, Durable Objects
- **Logging**: Pino

## Important Notes

1. **Service Bindings**: Workers communicate via Cloudflare service bindings (no network hops)
2. **Environment Variables**: Each worker needs `.dev.vars` file (copy from `.dev.vars.example`)
3. **Turbo Cache**: Build outputs cached in `dist/**` and `.wrangler/**`
4. **TypeScript Types**: Generate with `pnpm cf-typegen` in each worker
5. **Domains**: Production runs on `api.backend.checkmate.sg`
6. **Observability**: All LLM calls tracked via Langfuse

## Service Ports (Local Development)

| Service | Port | Inspector |
|---------|------|-----------|
| api-entrypoint | 8787 | 9229 |
| agent-service | 8788 | 9230 |
| screenshot-service | 8789 | 9231 |
| search-service | 8790 | 9232 |
| urlscan-service | 8791 | 9233 |
| screenshot-backup-service | 8792 | 9234 |
| embedder-service | 8793 | 9235 |
| trivialfilter-service | 8794 | 9236 |