/**
 * Generates a consistent SHA-256 hash for the given text.
 * Uses the Web Crypto API which is available in Cloudflare Workers.
 * 
 * @param text - The text to hash
 * @returns A hexadecimal string representation of the hash
 */
export async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}