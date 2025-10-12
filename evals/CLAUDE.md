# CheckMate AI Evaluation System

This folder implements **G-Eval benchmarking** for CheckMate AI using **Promptfoo**, evaluating content analysis responses against expert-labeled test cases.

## Overview

The evaluation system tests CheckMate's `/getAgentResult` endpoint against a Google Sheets dataset of expert-labeled cases, measuring both content quality and metadata accuracy.

## Quick Start

### Running Evaluations

```bash
pnpm eval:local   # Run sequentially (concurrency=1)
pnpm eval:remote  # Run in parallel (concurrency=10)
```

Results are timestamped and saved to `output/YYYYMMDD-HHMMSS-results.json`.

### Viewing Results

```bash
pnpm viewer  # Start web viewer at http://localhost:3000
```

The viewer provides:
- **Dropdown selector** - Auto-loads all JSON files from `output/` folder
- **Metrics dashboard** - Pass rate, test counts, average score, total latency
- **Test table** - Expandable rows showing:
  - Test inputs (text, image with preview, caption)
  - Expert labels (category, flags, pointers)
  - Provider output (en, cn, links, metadata)
  - Assertion results (G-Eval scores/reasons, boolean checks)
- **Delete functionality** - Remove result files directly from the UI

## Architecture

### Files
- `eval.g-eval-runner.yaml` - Main config using custom TypeScript provider with retry logic
- `eval.g-eval-api.yaml` - Alternative config for direct HTTP calls (no retry)
- `runner.ts` - Custom Promptfoo provider with 3-attempt retry logic and response transformation
- `viewer.html` - Single-page web app for viewing eval results (Alpine.js)
- `server.js` - Node.js server providing file listing and deletion APIs
- `.env` - Environment variables (`ML_SERVER_URL`, `ML_SERVER_API_KEY`)

### Test Data Source
Google Sheets: [Test Cases](https://docs.google.com/spreadsheets/d/1JnU9_GmWkww5LZqgUBQVh8ijkrLxhocz6FYef120tIU/edit)

Expected columns:
- `input_text`, `input_image_url`, `input_caption` - Test inputs
- `expert_pointers` - Expected content points (for G-Eval)
- `expert_is_access_blocked`, `expert_is_controversial`, `expert_is_video` - Expected boolean flags
- `expert_broad_category` - Expected category (bad/good/caution/satire/nothing)

## Evaluation Criteria

### Weighted Scoring
1. **G-Eval Content Match (weight: 5)** - GPT-4.1 scores how well the response covers `expert_pointers`, considering importance order
2. **Broad Category Match (weight: 5)** - Emoji prefix mapping:
   - 🚨/❌ → bad
   - ✅/🟢 → good
   - ⚠️/❗/❓ → caution
   - 🎭 → satire
   - 📝 → nothing
3. **Boolean Flags (weight: 1 each)** - Exact match for `isAccessBlocked`, `isControversial`, `isVideo`

### Threshold
Default: 0.7 (70% weighted score required to pass)

## Custom Provider Features

`runner.ts` implements:
- Automatic retry (3 attempts, 1s delay)
- Response transformation (extracts `en`, `cn`, `links`, flags, `broadCategory`)
- Tracks `numRetries` in output
- Error handling and logging
