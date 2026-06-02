/**
 * Travel interest categories (Stage 1).
 *
 * A small, shared source of truth for the "interest category" chips that:
 *   1. shape generation  — passed to convex/travelActions.planTrip, injected into
 *      the planner system prompt and the emit_itinerary tool schema (the model
 *      tags each item with one of these slugs);
 *   2. filter display    — the planner stores the chosen slug into the item's
 *      `tags` array, so the timeline can show only items whose category is in the
 *      currently-enabled set.
 *
 * Conventions (mirrors src/lib/travel/wmo.ts):
 *   - icon-library-agnostic: each category carries a stable `iconName` (a
 *     lucide-react export name) rather than a component, so this module stays a
 *     pure, SSR-safe, dependency-free data helper importable from server or
 *     client. Consumers map `iconName` → an actual icon.
 *   - `kind` is the COARSE trip-item kind used elsewhere ("food" | "place" |
 *     "activity"), so a category also hints at the item kind the planner should
 *     emit.
 *
 * Backward compatible: an empty enabled-set means "all categories" (no filter,
 * no generation constraint).
 */

/** lucide-react export names used by the category list. */
export type CategoryIconName =
  | "Utensils"
  | "Coffee"
  | "Landmark"
  | "Trees"
  | "Wine"
  | "ShoppingBasket"
  | "Mountain";

/** Coarse trip-item kind a category maps onto. */
export type CategoryKind = "food" | "place" | "activity";

export interface InterestCategory {
  /** Stable slug — stored into tripItems.tags and passed to planTrip. */
  slug: string;
  /** Human label for the chip. */
  label: string;
  /** Coarse item kind hint (food | place | activity). */
  kind: CategoryKind;
  /** lucide-react export name (consumer resolves to a component). */
  iconName: CategoryIconName;
}

/** The canonical interest-category list. Order = chip render order. */
export const INTEREST_CATEGORIES: readonly InterestCategory[] = [
  { slug: "restaurants", label: "Restaurants", kind: "food", iconName: "Utensils" },
  { slug: "cafes", label: "Cafés", kind: "food", iconName: "Coffee" },
  { slug: "attractions", label: "Attractions", kind: "place", iconName: "Landmark" },
  { slug: "nature", label: "Nature", kind: "activity", iconName: "Trees" },
  { slug: "bars", label: "Bars", kind: "food", iconName: "Wine" },
  { slug: "markets", label: "Markets", kind: "place", iconName: "ShoppingBasket" },
  { slug: "viewpoints", label: "Viewpoints", kind: "place", iconName: "Mountain" },
] as const;

/** All valid category slugs (for validation / membership tests). */
export const CATEGORY_SLUGS: readonly string[] = INTEREST_CATEGORIES.map(
  (c) => c.slug,
);

const BY_SLUG: ReadonlyMap<string, InterestCategory> = new Map(
  INTEREST_CATEGORIES.map((c) => [c.slug, c]),
);

/** Look up a category by slug (undefined if unknown). */
export function categoryBySlug(slug: string | undefined): InterestCategory | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

/**
 * Read the category slug an item was tagged with, if any. The planner prepends
 * the category slug to `tags`, so the FIRST tag that is a known category slug
 * wins. Returns undefined for items with no category tag (these always show).
 */
export function itemCategorySlug(tags: readonly string[] | undefined): string | undefined {
  if (!tags || tags.length === 0) return undefined;
  for (const t of tags) {
    if (BY_SLUG.has(t)) return t;
  }
  return undefined;
}

/**
 * Should an item be shown given the enabled-category set?
 *   - empty `enabled` → all items show (no filter).
 *   - item with no category tag → always shows.
 *   - otherwise → show only when the item's category is enabled.
 */
export function itemMatchesCategories(
  tags: readonly string[] | undefined,
  enabled: readonly string[] | undefined,
): boolean {
  if (!enabled || enabled.length === 0) return true;
  const slug = itemCategorySlug(tags);
  if (!slug) return true;
  return enabled.includes(slug);
}
