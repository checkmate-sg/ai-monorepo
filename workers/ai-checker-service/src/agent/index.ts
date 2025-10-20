// Agent configuration and setup
// This file can export any agent-specific configuration or utilities

export interface AgentContext {
  searchesRemaining: number;
  screenshotsRemaining: number;
}

export const DEFAULT_MAX_SEARCHES = 5;
export const DEFAULT_MAX_SCREENSHOTS = 5;
export const DEFAULT_MAX_STEPS = 50;
