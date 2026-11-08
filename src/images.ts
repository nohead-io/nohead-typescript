/**
 * Image renditions without a request (`@nohead/sdk/images`). Image URLs are
 * open: an image asset's `image_url` serves the whole image, and imgproxy's
 * open-source processing options written into it transform it (listed at
 * https://docs.nohead.io/guides/images#supported-options). No dependencies,
 * so it suits browser bundles and frameworks' image components (Astro's image
 * service is `@nohead/astro/image-service`).
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
  /**
   * Other processing options, as written in a URL: `["bl:2", "sh:0.5"]`.
   * Image URLs take imgproxy's open-source options: size and crop (`rs`, `s`,
   * `rt`, `w`, `h`, `mw`, `mh`, `z`, `dpr`, `el`, `ex`, `exar`, `g`, `c`, `t`,
   * `pd`), orientation (`ar`, `rot`, `fl`), effects (`bg`, `bl`, `sh`, `pix`),
   * output (`q`, `fq`, `f`, `kcr`, `scp`, `ph`, `eth`) and delivery (`cb`,
   * `exp`, `fn`, `att`, `pr:preview`), by short or long name. Any other, such
   * as imgproxy Pro's `sa`, `mc`, `ad` or `co`, would make the URL answer
   * 404, so it throws, naming the option.
   */
  options?: string[]
}

/** An image asset, or its `image_url`. */
export type ImageSource = string | { image_url: string | null }

const FITS = { contain: "fit", cover: "fill", fill: "force" } as const

/**
 * The processing options image URLs take (imgproxy's open-source ones, by
 * short and long name): any other answers 404, so imageUrl refuses it.
 * https://docs.nohead.io/guides/images#supported-options
 */
const SUPPORTED = new Set(
  (
    "rs resize s size rt resizing_type w width h height mw min-width mh min-height " +
    "z zoom dpr el enlarge ex extend exar extend_aspect_ratio extend_ar g gravity c crop " +
    "t trim pd padding ar auto_rotate rot rotate fl flip bg background bl blur " +
    "sh sharpen pix pixelate q quality fq format_quality f format ext " +
    "kcr keep_copyright scp strip_color_profile ph preserve_hdr " +
    "eth enforce_thumbnail cb cachebuster exp expires fn filename " +
    "att return_attachment pr preset"
  ).split(" ")
)

/** Refuses an option image URLs don't take, naming it. */
function checkSupported(option: string) {
  const at = option.indexOf(":")
  const name = at < 0 ? option : option.slice(0, at)
  // The only preset is preview_url's.
  const preset =
    (name === "pr" || name === "preset") && option.slice(at + 1) !== "preview"
  if (!SUPPORTED.has(name) || preset)
    throw new TypeError(
      `${preset ? option : name} isn't an option Nohead image URLs take (imgproxy Pro's, such as sa, mc or co, aren't available): https://docs.nohead.io/guides/images#supported-options`
    )
}
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
  others.forEach(checkSupported)
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
