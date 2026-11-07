/**
 * Astro's image service for Nohead images
 * (`@nohead/sdk/astro/image-service`). In astro.config:
 *
 *   image: { service: { entrypoint: "@nohead/sdk/astro/image-service" } }
 *
 * then `<Image src={asset.image_url} width={…} height={…} alt={…} />`.
 * `<Image>` and `<Picture>` write each size and format into the image's
 * URL, and Nohead makes it on request, so the build never downloads or
 * resizes an image. Astro's base service supplies the rest (the `<img>`
 * attributes, `srcset` for `widths` and `densities`). WebP unless a
 * `format` says otherwise. With `widths`, an image's URL is never larger than
 * the largest of them: pass the asset's own `width` and `height`, and its
 * `src` (the fallback for browsers without `srcset`) is made at that largest
 * width, not the original's. Other images (the site's own, imported or remote) are
 * served as they are.
 *
 * Defaults for every image go in the service's `config`, and an image's own
 * `quality` or `format` wins:
 *
 *   service: { entrypoint: "@nohead/sdk/astro/image-service", config: { quality: 70 } }
 */
import type { ExternalImageService, ImageTransform } from "astro"
import { baseService } from "astro/assets"

import { fitOf, formatOf, qualityOf } from "./frameworks.ts"
import { imageUrl, isImageUrl } from "./images.ts"

/** The service's `config` in astro.config: defaults for every image. */
export interface ImageServiceConfig {
  /** 1 to 100, or one of Astro's presets (`"high"` is 80). */
  quality?: number | "low" | "mid" | "high" | "max"
  /** `"webp"` unless set. */
  format?: "webp" | "avif" | "jpeg" | "jpg" | "png"
}

/**
 * The size an image's URL is made at: its own, but at most the largest of
 * its `widths`, the height scaled with it. Astro makes `src` (the fallback
 * for browsers without `srcset`) at the image's own size, and sites pass an
 * asset's, an original's, which can be huge; capped, `src` is the largest
 * `srcset` entry, one URL the CDN makes once. Only the URL: the `width` and
 * `height` attributes stay the image's, its display size without CSS.
 * Without `widths` (`densities`, or one size), the size asked for.
 */
function sizeOf({ width, height, widths }: ImageTransform) {
  const largest = widths?.length ? Math.max(...widths) : undefined
  if (!largest || typeof width !== "number" || width <= largest)
    return { width, height }
  return {
    width: largest,
    height:
      typeof height === "number"
        ? Math.round((height * largest) / width)
        : height,
  }
}

const imageService: ExternalImageService<ImageServiceConfig> = {
  getHTMLAttributes: baseService.getHTMLAttributes,
  getSrcSet: baseService.getSrcSet,
  async validateOptions(options, imageConfig, logger) {
    const validated: ImageTransform = await baseService.validateOptions!(
      options,
      imageConfig,
      logger
    )
    // So the srcset's <source type> says what the URLs serve.
    if (isImageUrl(validated.src)) {
      // A Picture's <source type> needs `jpeg`, not `jpg`.
      validated.format ??=
        formatOf(imageConfig?.service?.config?.format) ?? "webp"
    }
    return validated
  },
  getURL(options, imageConfig) {
    const defaults = imageConfig?.service?.config
    const { src } = options
    // An imported image's metadata, or another URL.
    if (!isImageUrl(src)) return typeof src === "string" ? src : src.src
    const { width, height } = sizeOf(options)
    return imageUrl(src, {
      width,
      height,
      fit: fitOf(options.fit, width, height),
      format: formatOf(options.format ?? defaults?.format ?? "webp"),
      quality: qualityOf(options.quality ?? defaults?.quality),
    })
  },
}

export default imageService
