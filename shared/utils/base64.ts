/**
 * Converts an ArrayBuffer to a base64 string in chunks to avoid stack overflow
 * on large buffers
 * @param buffer - ArrayBuffer to convert
 * @param chunkSize - Size of chunks to process (default: 8192)
 * @returns Base64 encoded string
 */
export function arrayBufferToBase64(
  buffer: ArrayBuffer,
  chunkSize: number = 8192
): string {
  const uint8Array = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
