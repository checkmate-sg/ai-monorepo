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

/**
 * Generates a consistent SHA-256 hash for a URL.
 * Normalizes the URL first to ensure consistent hashing.
 * Uses the Web Crypto API which is available in Cloudflare Workers.
 *
 * @param url - The URL to hash
 * @returns A hexadecimal string representation of the hash
 */
export async function hashUrl(url: string): Promise<string> {
  const normalizedUrl = new URL(url).toString();
  return hashText(normalizedUrl);
}

/**
 * Generates a PDQ perceptual hash for the given image.
 * Uses the PDQ worker service via service binding.
 *
 * @param imageData - The image data as ArrayBuffer or Uint8Array
 * @param pdqService - The PDQ service binding (Fetcher)
 * @returns A 64-character hexadecimal string representation of the PDQ hash
 */
export async function hashImage(
  imageData: ArrayBuffer | Uint8Array,
  pdqService: Fetcher
): Promise<string> {
  const buffer =
    imageData instanceof Uint8Array
      ? new Uint8Array(imageData.buffer)
      : new Uint8Array(imageData);

  const response = await pdqService.fetch("http://pdq/pdq", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: buffer,
  });

  if (!response.ok) {
    throw new Error(
      `PDQ service error: ${response.status} ${response.statusText}`
    );
  }

  const result = (await response.json()) as {
    hash_hex: string;
    quality: number;
  };
  return result.hash_hex;
}

/**
 * Generates a PDQ perceptual hash for an image from a URL.
 * Uses the PDQ worker service via service binding.
 *
 * @param imageUrl - The URL of the image to hash
 * @param pdqService - The PDQ service binding (Fetcher)
 * @returns A 64-character hexadecimal string representation of the PDQ hash
 */
export async function hashImageFromUrl(
  imageUrl: string,
  pdqService: Fetcher
): Promise<string> {
  const response = await pdqService.fetch("http://pdq/pdq", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: imageUrl }),
  });

  if (!response.ok) {
    throw new Error(
      `PDQ service error: ${response.status} ${response.statusText}`
    );
  }

  const result = (await response.json()) as {
    hash_hex: string;
    quality: number;
  };
  return result.hash_hex;
}

/**
 * Calculates the hamming distance between two PDQ hashes.
 * Distance 0-31 indicates very similar images.
 *
 * @param hash1 - First 64-character hexadecimal PDQ hash
 * @param hash2 - Second 64-character hexadecimal PDQ hash
 * @returns The hamming distance between the two hashes
 */
export function compareImageHashes(hash1: string, hash2: string): number {
  if (hash1.length !== 64 || hash2.length !== 64) {
    throw new Error("PDQ hashes must be exactly 64 characters");
  }

  let distance = 0;
  for (let i = 0; i < 64; i++) {
    const byte1 = parseInt(hash1[i], 16);
    const byte2 = parseInt(hash2[i], 16);
    const xor = byte1 ^ byte2;
    // Count number of 1s in the XOR result
    distance +=
      (xor & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
  }

  return distance;
}

/**
 * Converts a PDQ hash to a binary vector representation for vector search.
 * Each hex character (4 bits) becomes 4 values in the vector (0 or 1).
 *
 * Note: Euclidean distance on these binary vectors approximates hamming distance.
 * For exact hamming distance, use compareImageHashes() instead.
 *
 * @param pdqHash - 64-character hexadecimal PDQ hash
 * @returns Array of 256 binary values (0 or 1)
 */
export function pdqHashToVector(pdqHash: string): number[] {
  if (pdqHash.length !== 64) {
    throw new Error("PDQ hash must be exactly 64 characters");
  }

  const vector: number[] = [];

  for (let i = 0; i < 64; i++) {
    const hexChar = parseInt(pdqHash[i], 16);
    // Convert 4-bit hex to 4 binary digits
    vector.push((hexChar >> 3) & 1); // bit 3
    vector.push((hexChar >> 2) & 1); // bit 2
    vector.push((hexChar >> 1) & 1); // bit 1
    vector.push(hexChar & 1); // bit 0
  }

  return vector;
}
