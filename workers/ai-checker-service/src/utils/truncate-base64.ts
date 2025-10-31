/**
 * Truncates base64 strings in an object to prevent excessive logging
 * Recursively walks through objects and arrays to find and truncate base64 data
 */
export function truncateBase64(obj: any): any {
  if (!obj) return obj;

  if (typeof obj === "string") {
    // Check for long base64-like strings (alphanumeric + / + =)
    if (obj.length > 2000 && /^[A-Za-z0-9+/]+=*$/.test(obj)) {
      return `[base64: ${obj.length} chars]`;
    }
    // Also handle data URLs just in case
    if (obj.startsWith("data:") && obj.includes("base64,")) {
      const parts = obj.split("base64,");
      return `[data URL base64: ${parts[1]?.length || 0} chars]`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(truncateBase64);
  }

  if (typeof obj === "object") {
    const result: any = {};
    for (const key in obj) {
      // Known base64 field names - truncate immediately if string > 2000 chars
      if (
        ["base64", "imageBase64", "image"].includes(key) &&
        typeof obj[key] === "string" &&
        obj[key].length > 2000
      ) {
        result[key] = `[base64: ${obj[key].length} chars]`;
      } else {
        result[key] = truncateBase64(obj[key]);
      }
    }
    return result;
  }

  return obj;
}
