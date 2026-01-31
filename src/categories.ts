/**
 * Shared category definitions for feed and tweet classification.
 */

export const CATEGORIES = [
  "AI/ML",
  "Funny",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Convert a category name to a URL-friendly slug.
 */
export function categoryToSlug(category: Category): string {
  return category
    .toLowerCase()
    .replace(/\//g, "-")       // Replace slashes (AI/ML -> AI-ML)
    .replace(/\s*&\s*/g, "-")  // Replace ampersands with hyphens
    .replace(/\s+/g, "-");     // Replace spaces with hyphens
}

/**
 * Convert a slug back to a category name.
 */
export function slugToCategory(slug: string): Category | undefined {
  const normalized = slug.toLowerCase();
  return CATEGORIES.find((cat) => categoryToSlug(cat) === normalized);
}

/**
 * Get all category slugs.
 */
export function getCategorySlugs(): string[] {
  return CATEGORIES.map(categoryToSlug);
}
