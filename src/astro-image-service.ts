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
 * `format` says otherwise. Other images (the site's own, imported or
 * remote) are served as they are.
 */
import type { ExternalImageService, ImageTransform } from "astro"
import { baseService } from "astro/assets"

import { fitOf, formatOf, qualityOf } from "./frameworks.ts"
import { imageUrl, isImageUrl } from "./images.ts"

const imageService: ExternalImageService = {
  getHTMLAttributes: baseService.getHTMLAttributes,
  getSrcSet: baseService.getSrcSet,
  async validateOptions(options, imageConfig, logger) {
    const validated: ImageTransform = await baseService.validateOptions!(
      options,
      imageConfig,
      logger
    )
    // So the srcset's <source type> says what the URLs serve.
    if (isImageUrl(validated.src)) validated.format ??= "webp"
    return validated
  },
  getURL(options) {
    const { src } = options
    // An imported image's metadata, or another URL.
    if (!isImageUrl(src)) return typeof src === "string" ? src : src.src
    return imageUrl(src, {
      width: options.width,
      height: options.height,
      fit: fitOf(options.fit, options.width, options.height),
      format: formatOf(options.format ?? "webp"),
      quality: qualityOf(options.quality),
    })
  },
}

export default imageService
