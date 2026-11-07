// What frameworks' image components pass, as imageUrl's options. Internal to
// @nohead/sdk/images (its Next.js and Nuxt loaders).
import type { ImageOptions } from "./images.ts"

const FORMATS: Record<string, ImageOptions["format"]> = {
  webp: "webp",
  avif: "avif",
  jpeg: "jpeg",
  jpg: "jpeg",
  png: "png",
}
// Nuxt Image's fits (and Astro's), as imgproxy has them.
const FITS: Record<string, ImageOptions["fit"]> = {
  cover: "cover",
  contain: "contain",
  fill: "fill",
  inside: "contain",
  outside: "cover",
  "scale-down": "contain",
}
/**
 * The fit asked for (an unknown one as `contain`, as Astro reads it), else
 * `cover` for a box of both sizes, as Astro's and Nuxt Image's own services
 * crop to it: an image fitted inside would be stretched to the <img>'s width
 * and height.
 */
export const fitOf = (fit: unknown, width?: number, height?: number) =>
  typeof fit === "string" && fit
    ? Object.hasOwn(FITS, fit)
      ? FITS[fit]
      : "contain"
    : width && height
      ? "cover"
      : undefined

/** Any other format (an SVG's `svg`) leaves the image in its own. */
export const formatOf = (format: unknown) =>
  typeof format === "string" && Object.hasOwn(FORMATS, format)
    ? FORMATS[format]
    : undefined

export const numberOf = (value: unknown) =>
  typeof value === "number"
    ? value
    : typeof value === "string" && value
      ? Number(value)
      : undefined
