import pino from "pino";

// Configure the logger for Cloudflare Workers
export const logger = pino({
  level: "debug", // Default level
  // No transport needed for Workers
  browser: {
    asObject: true,
  },
  // Custom timestamp that formats the time in Singapore time (UTC+8)
  timestamp: () => {
    const now = new Date();

    // Add 8 hours for Singapore time (UTC+8)
    const sgTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);

    // Format as ISO string and remove the 'Z' at the end
    const isoString = sgTime.toISOString();
    const formattedTime = isoString.replace("Z", "+08:00");

    return formattedTime;
  },
  // Optional: Customize the base log object
  base: null, // Removes the default pid and hostname fields
});

// Create namespaced loggers
export const createLogger = (namespace: string) => {
  return logger.child({ namespace });
};

// Helper function to get log level
// In Workers, you would typically get this from env bindings
export const getLogLevel = (env?: any) => {
  // If env is passed (from worker environment), you can use it
  // return env?.LOG_LEVEL || "info";
  return "debug";
};
