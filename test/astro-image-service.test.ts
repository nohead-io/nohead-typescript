import type { ImageTransform } from "astro"
import { describe, expect, it } from "vitest"

import imageService from "../src/astro-image-service.ts"

const base =
  "https://images.nohead.io/plain/0199f5c2-7b1e-7c3a-9d4f-2a6b8c0e1f3d/0199f5c2-8a2d-7e4b-b1c3-5d7e9f1a2b4c"
const at = (options: string) => base.replace("/plain/", `/${options}/plain/`)

type Config = Parameters<typeof imageService.getURL>[1]
type Logger = Parameters<typeof imageService.getURL>[2]
const config = {} as Config
const logger = {} as Logger

/**
 * What Astro's getImage does with an <Image>'s props (astro/assets,
 * getImage): validate them, then ask for the srcset, the URLs and the
 * attributes.
 */
async function image(props: ImageTransform) {
  const options = await imageService.validateOptions!(
    { ...props },
    config,
    logger
  )
  const srcSet = await imageService.getSrcSet!(options, config, logger)
  return {
    src: await imageService.getURL(options, config, logger),
    srcset: await Promise.all(
      srcSet.map(
        async ({ transform, descriptor, attributes }) =>
          [
            await imageService.getURL(transform, config, logger),
            descriptor,
            attributes,
          ] as const
      )
    ),
    attributes: await imageService.getHTMLAttributes!(options, config, logger),
  }
}

describe("the Astro image service", () => {
  it("renders an <Image> with its alt, size and srcset, as WebP, cropped to its box", async () => {
    const rendered = await image({
      src: base,
      width: 800,
      height: 600,
      alt: "A chalkboard",
      widths: [400, 800],
      class: "cover",
    })
    expect(rendered.src).toBe(`${at("rs:fill:800:600")}@webp`)
    expect(rendered.attributes).toEqual({
      alt: "A chalkboard",
      class: "cover",
      width: 800,
      height: 600,
      loading: "lazy",
      decoding: "async",
    })
    expect(rendered.srcset).toEqual([
      [`${at("rs:fill:400:300")}@webp`, "400w", { type: "image/webp" }],
      [`${at("rs:fill:800:600")}@webp`, "800w", { type: "image/webp" }],
    ])
  })

  it("takes Astro's formats, fits and qualities", async () => {
    const url = async (props: Partial<ImageTransform>) =>
      (await image({ src: base, width: 300, height: 200, ...props })).src
    expect(await url({ format: "avif" })).toBe(`${at("rs:fill:300:200")}@avif`)
    expect(await url({ format: "jpg" })).toBe(`${at("rs:fill:300:200")}@jpeg`)
    expect(await url({ fit: "contain", quality: "high" })).toBe(
      `${at("rs:fit:300:200/q:80")}@webp`
    )
    expect(await url({ fit: "scale-down" })).toBe(
      `${at("rs:fit:300:200")}@webp`
    )
    expect(await url({ fit: "somehow" })).toBe(`${at("rs:fit:300:200")}@webp`)
    expect(await url({ quality: 70 })).toBe(
      `${at("rs:fill:300:200/q:70")}@webp`
    )
    expect(await url({ quality: "60" })).toBe(
      `${at("rs:fill:300:200/q:60")}@webp`
    )
    // An SVG kept as a vector: no format, so the image's own.
    expect(await url({ format: "svg" })).toBe(at("rs:fill:300:200"))
  })

  it("serves the site's own images as they are", () => {
    expect(
      imageService.getURL(
        {
          src: {
            src: "/_astro/logo.png",
            width: 100,
            height: 100,
            format: "png",
          },
          width: 100,
        },
        config,
        logger
      )
    ).toBe("/_astro/logo.png")
    expect(
      imageService.getURL(
        { src: "https://example.com/cat.png", width: 100 },
        config,
        logger
      )
    ).toBe("https://example.com/cat.png")
  })
})
