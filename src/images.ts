/**
 * Image renditions without a request (`@nohead/sdk/images`). Image URLs are
 * open: an image asset's `image_url` serves the whole image, and any of
 * imgproxy's processing options written into it transform it
 * (https://docs.imgproxy.net/usage/processing). No dependencies, so it suits
 * browser bundles and frameworks' image components (Astro's image service is
 * `@nohead/sdk/astro/image-service`).
 *
 *   imageUrl(asset, { width: 800, height: 600, fit: "cover", format: "webp" })
 */
import { fitOf, formatOf, numberOf } from "./frameworks.ts"

export interface ImageOptions {
  width?: number
  height?: number
  /** `contain` fits inside the box (the default), `cover` fills it, cropping, `fill` stretches to it. */
  fit?: "contain" | "cover" | "fill"
  format?: "webp" | "avif" | "jpeg" | "png"
  /** 1 to 100. */
  quality?: number
  /** Pixel density: 2 for a 2x screen. */
  dpr?: number
  /** What a crop keeps, as imgproxy's gravity: `sm` (smart), `ce`, `no`, or `fp:0.5:0.3` (a focal point). */
  gravity?: string
  /** Any other processing options, as written in a URL: `["bl:2", "sh:0.5"]`. */
  options?: string[]
}

/** An image asset, or its `image_url`. */
export type ImageSource = string | { image_url: string | null }

const FITS = { contain: "fit", cover: "fill", fill: "force" } as const
// The format an image URL names, after its source: `…@webp`.
const FORMAT = /@[a-z]+$/

/** A rendition of an image: its `image_url` with these options. */
export function imageUrl(
  image: ImageSource,
  options: ImageOptions = {}
): string {
  const base = typeof image === "string" ? image : image.image_url
  if (!base) throw new TypeError("Not a ready image: it has no image_url")
  const at = base.indexOf("/plain/")
  if (at < 0) throw new TypeError(`Not a Nohead image URL: ${base}`)

  // Empty options count as unset.
  const { width, height, format, quality, dpr, gravity } = options
  const fit = options.fit || "contain"
  if (!Object.hasOwn(FITS, fit))
    throw new TypeError(`fit must be one of ${Object.keys(FITS).join(", ")}`)
  const others = (options.options ?? []).filter(Boolean)
  for (const option of [gravity, ...others])
    if (option && /[/@?#]/.test(option))
      throw new TypeError(`Not an imgproxy option: ${option}`)
  const segments: string[] = []
  if (width || height)
    segments.push(`rs:${FITS[fit]}:${width ?? 0}:${height ?? 0}`)
  if (gravity) segments.push(`g:${gravity}`)
  if (dpr) segments.push(`dpr:${dpr}`)
  if (quality) segments.push(`q:${quality}`)
  segments.push(...others)

  // The source comes last; a format replaces any the URL already names.
  let source = base.slice(at)
  if (format) source = `${source.replace(FORMAT, "")}@${format}`
  return `${base.slice(0, at)}${segments.map((s) => `/${s}`).join("")}${source}`
}

/** Whether a URL is a Nohead image's: the loaders leave any other alone. */
export function isImageUrl(src: unknown): src is string {
  return (
    typeof src === "string" && /^https?:\/\/[^/]+\/(.*\/)?plain\//.test(src)
  )
}

/**
 * A Next.js image loader. In a file named by `images.loaderFile` in
 * next.config: `export { nextImageLoader as default } from "@nohead/sdk/images"`,
 * then `<Image src={asset.image_url} width={…} height={…} alt={asset.alt} />`.
 * As WebP, which Next.js's own optimizer would pick, unless the URL names a
 * format: `${asset.image_url}@png`, or `@svg` to keep an SVG a vector.
 * Other images (the site's own) are left as they are.
 */
export function nextImageLoader({
  src,
  width,
  quality,
}: {
  src: string
  width: number
  quality?: number
}): string {
  if (!isImageUrl(src)) return src
  // A loader is given no format: one the URL names stays.
  const format = FORMAT.test(src) ? undefined : "webp"
  return imageUrl(src, { width, quality, format })
}

/**
 * Nuxt Image's custom provider (`getImage`). In a file named as a provider
 * in nuxt.config's `image.providers`: on Nuxt Image 2,
 * `export { nuxtImageProvider as default } from "@nohead/sdk/images"`; on
 * Nuxt Image 1, `export { getImage } from "@nohead/sdk/images"`. Other
 * images are left as they are.
 */
export function getImage(
  src: string,
  { modifiers = {} }: { modifiers?: Record<string, unknown> } = {}
): { url: string } {
  if (!isImageUrl(src)) return { url: src }
  const width = numberOf(modifiers.width)
  const height = numberOf(modifiers.height)
  return {
    url: imageUrl(src, {
      width,
      height,
      fit: fitOf(modifiers.fit, width, height),
      format: formatOf(modifiers.format),
      quality: numberOf(modifiers.quality),
    }),
  }
}

/** Nuxt Image 2's provider: what its `defineProvider({ getImage })` returns. */
export const nuxtImageProvider = () => ({ getImage })
