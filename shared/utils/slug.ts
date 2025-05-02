/**
 * Utility functions for generating slugs
 */

/**
 * Generates a URL-friendly slug from a title and ID
 * @param title The title to convert to a slug
 * @param id The ID to append to the slug (first 6 characters will be used)
 * @returns A URL-friendly slug composed of the title and ID
 */
export function getSlugFromTitle(title: string | null, id: string): string {
  if (!title) {
    return id.slice(0, 6);
  }

  const slug = title
    .toLowerCase() // convert to lowercase
    .trim() // remove leading/trailing spaces
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric groups with single hyphen
    .replace(/^-+|-+$/g, ""); // remove leading/trailing hyphens

  // append first 6 characters of id
  return `${slug}-${id.slice(0, 6)}`;
}
