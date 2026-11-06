// What frameworks' image components pass, as imageUrl's options. Internal:
// shared by @nohead/sdk/images and @nohead/sdk/astro/image-service.
import type { ImageOptions } from "./images.ts"

const FORMATS: Record<string, ImageOptions["format"]> = {
  webp: "webp",
  avif: "avif",
  jpeg: "jpeg",
  jpg: "jpeg",
  png: "png",
}
// Astro's and Nuxt Image's fits, as imgproxy has them.
const FITS: Record<string, ImageOptions["fit"]> = {
  cover: "cover",
  contain: "contain",
  fill: "fill",
  inside: "contain",
  outside: "cover",
  "scale-down": "contain",
}
// Astro's quality presets, as its own services read them.
const QUALITIES: Record<string, number> = {
  low: 25,
  mid: 50,
  high: 80,
  max: 100,
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

export const qualityOf = (quality: unknown) =>
  typeof quality === "string" && Object.hasOwn(QUALITIES, quality)
    ? QUALITIES[quality]
    : numberOf(quality)
