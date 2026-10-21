/**
 * Image renditions without a request (`@nohead/sdk/images`). Image URLs are
 * open: an image asset's `image_url` serves the whole image, and any of
 * imgproxy's processing options written into it transform it
 * (https://docs.imgproxy.net/usage/processing). No dependencies, so it suits
 * browser bundles and frameworks' image components.
 *
 *   imageUrl(asset, { width: 800, height: 600, fit: "cover", format: "webp" })
 */

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

/** A rendition of an image: its `image_url` with these options. */
export function imageUrl(
  image: ImageSource,
  options: ImageOptions = {}
): string {
  const base = typeof image === "string" ? image : image.image_url
  if (!base) throw new TypeError("Not a ready image: it has no image_url")
  const at = base.indexOf("/plain/")
  if (at < 0) throw new TypeError(`Not a Nohead image URL: ${base}`)

  const {
    width,
    height,
    fit = "contain",
    format,
    quality,
    dpr,
    gravity,
  } = options
  const segments: string[] = []
  if (width || height)
    segments.push(`rs:${FITS[fit]}:${width ?? 0}:${height ?? 0}`)
  if (gravity) segments.push(`g:${gravity}`)
  if (dpr) segments.push(`dpr:${dpr}`)
  if (quality) segments.push(`q:${quality}`)
  segments.push(...(options.options ?? []))

  // The source comes last; a format replaces any the URL already names.
  let source = base.slice(at)
  if (format) source = `${source.replace(/@[a-z]+$/, "")}@${format}`
  return `${base.slice(0, at)}${segments.map((s) => `/${s}`).join("")}${source}`
}

/**
 * A Next.js image loader. In a file named by `images.loaderFile` in
 * next.config: `export { nextImageLoader as default } from "@nohead/sdk/images"`,
 * then `<Image src={asset.image_url} width={…} height={…} alt={asset.alt} />`.
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
  return imageUrl(src, { width, quality })
}

const FORMATS = new Set<string>(["webp", "avif", "jpeg", "png"])
const NUXT_FITS: Record<string, ImageOptions["fit"]> = {
  cover: "cover",
  contain: "contain",
  fill: "fill",
}

/**
 * An Astro image service (an external one: Astro never fetches the image).
 * In a module named by `image.service.entrypoint` in astro.config:
 * `export { astroImageService as default } from "@nohead/sdk/images"`.
 */
export const astroImageService = {
  getURL(options: {
    src: unknown
    width?: number
    height?: number
    format?: string
    quality?: number | string
  }): string {
    if (typeof options.src !== "string")
      throw new TypeError("The Nohead image service takes image_url strings")
    return imageUrl(options.src, {
      width: options.width,
      height: options.height,
      format:
        options.format && FORMATS.has(options.format)
          ? (options.format as ImageOptions["format"])
          : undefined,
      quality:
        typeof options.quality === "number" ? options.quality : undefined,
    })
  },
}

/**
 * Nuxt Image's custom provider (`getImage`). In a file named as a provider
 * in nuxt.config's `image.providers`: `export { getImage } from "@nohead/sdk/images"`.
 */
export function getImage(
  src: string,
  { modifiers = {} }: { modifiers?: Record<string, unknown> } = {}
): { url: string } {
  const number = (value: unknown) =>
    typeof value === "number"
      ? value
      : typeof value === "string" && value
        ? Number(value)
        : undefined
  const format =
    typeof modifiers.format === "string" && FORMATS.has(modifiers.format)
      ? (modifiers.format as ImageOptions["format"])
      : undefined
  return {
    url: imageUrl(src, {
      width: number(modifiers.width),
      height: number(modifiers.height),
      fit:
        typeof modifiers.fit === "string"
          ? NUXT_FITS[modifiers.fit]
          : undefined,
      format,
      quality: number(modifiers.quality),
    }),
  }
}
