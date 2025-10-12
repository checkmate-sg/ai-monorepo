# CheckMate Evals

This directory contains evaluation scripts for testing the CheckMate AI system using [promptfoo](https://www.promptfoo.dev/).

## Setup

### 1. Install Dependencies

From the monorepo root:

```bash
pnpm install
pnpm approve-builds
```

When prompted, approve `better-sqlite3` to build native bindings.

### 2. Environment Variables

Copy the example file and get credentials from the repository owner:

```bash
cp .env.example .env
```

Contact the repository owner for the required environment variables:

- `ML_SERVER_API_KEY`
- `ML_SERVER_URL` (default: `http://localhost:8787`)
- `OPENAI_API_KEY`
- `EVALS_GOOGLE_SHEET_URL`
- `GOOGLE_APPLICATION_CREDENTIALS`

## Running Evals

### Prerequisites

**Important**: Start the development server in a separate terminal before running evals:

```bash
# In terminal 1 - start dev server
pnpm dev
```

Wait for all services to start, then run the evals:

### From Monorepo Root

```bash
# In terminal 2 - run evals
pnpm eval
```

### From This Directory

```bash
# In terminal 2 - run evals
pnpm eval:local   # For local dev (concurrency: 1)
pnpm eval:remote  # For remote server (concurrency: 10)
```

### Limiting Test Cases

To run faster by testing only the first N cases:

```bash
pnpm eval:local --filter-first-n 10   # Run only first 10 tests
pnpm eval:remote --filter-first-n 5   # Run only first 5 tests
```

You can also filter by pattern:

```bash
pnpm eval:local --filter-pattern "scam"  # Only run tests matching "scam"
```

## Configuration

### Eval Configs

#### `eval.g-eval-runner.yaml` (Custom Provider with Retries)

This implements G-Eval methodology using a custom TypeScript provider (`runner.ts`) that includes retry logic.

**Test Data Source**: Google Sheets

- Tests are loaded from the configured Google Sheet
- Results are written back to the sheet and local files

**Evaluation Criteria** (weighted):

- **G-Eval (weight: 5)**: Checks if response contains expert pointers using `output.en`
- **isAccessBlocked (weight: 1)**: Validates access blocking flag (equals assertion)
- **isControversial (weight: 1)**: Validates controversial flag (equals assertion)
- **isVideo (weight: 1)**: Validates video detection (equals assertion)
- **Broad Category (weight: 5)**: Validates emoji-based category classification (equals assertion)
- **numRetries (weight: 0)**: Tracks retry count without affecting score

**Passing Threshold**: 0.7 (70% weighted average across all assertions)

**Retry Logic**: Custom provider retries failed requests up to 3 times with 1 second delay between attempts

#### `eval.g-eval-api.yaml` (HTTP Provider)

Legacy configuration using promptfoo's built-in HTTP provider (no retry logic)

### Output

Results are saved to:

- Google Sheets (automatically synced) to a new spreadsheet
- `./output/results.json`
- `./output/results.csv`

## How It Works

1. **Test data** is fetched from Google Sheets
2. Each test case is sent to the ML server endpoint (`/getAgentResult`)
3. The response is evaluated against multiple assertions with different weights
4. A weighted average score is calculated
5. Tests pass if score is greater than 0.7
6. Results are written back to Google Sheets and local files

## Customization

### Adjust Passing Threshold

Edit `eval.g-eval.yaml`:

```yaml
defaultTest:
  threshold: 0.8 # Change from 0.7 to 0.8 for stricter evaluation
```

### Modify Weights

Adjust assertion weights to change their relative importance:

```yaml
- type: g-eval
  weight: 10 # Increase from 5 to make this more important
```

### Add New Assertions

Add new evaluation criteria under `defaultTest.assert`:

```yaml
# Using equals assertion
- type: equals
  weight: 1
  transform: output.someField
  value: "{{expected_value}}"

# Using JavaScript for complex logic
- type: javascript
  weight: 1
  value: |
    // Custom validation logic
    return {
      pass: output.someField === context.vars.expected,
      score: 1,
      reason: "Custom check passed"
    };
```

## Troubleshooting

### Database Migration Errors

If you see `better-sqlite3` binding errors, the native module wasn't built. Go and perform the approve-builds step in the installation instructions again.

### Missing Environment Variables

Ensure `.env` file exists with all required variables:

- `ML_SERVER_API_KEY`
- `ML_SERVER_URL`
- `OPENAI_API_KEY`
- `EVALS_GOOGLE_SHEET_URL`
- `GOOGLE_APPLICATION_CREDENTIALS`

The eval will fail if any of these are missing.
