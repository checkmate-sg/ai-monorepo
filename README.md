# Introduction

This is a monorepo for the Cloudflare Workers-based AI service that CheckMate users.

# Installation

1. Install pnpm globally (if not already installed):

```bash
npm install -g pnpm
```

2. Clone the repository:

```bash
git clone https://github.com/your-username/checkmate-ai-monorepo.git
cd checkmate-ai-monorepo
```

3. Install dependencies:

```bash
pnpm install
```

4. Set up environment variables:

   - Copy `.dev.vars.example` to `.dev.vars` in each worker directory
   - Fill in the required environment variables in each `.dev.vars` file

# Development

- To run a specific worker:

```bash
pnpm run dev:<worker-name>
```

- To run all workers simultaneously:

```bash
pnpm run dev
```

This will start all workers concurrently based on the pipeline configuration in `turbo.json`. You can access them at:

- api-entrypoint: http://127.0.0.1:8787
- agent-service: http://127.0.0.1:8788
- screenshot-service: http://127.0.0.1:8789
- search-service: http://127.0.0.1:8790
- urlscan-service: http://127.0.0.1:8791
