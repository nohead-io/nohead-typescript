import { describe, expect, it } from "vitest"

import {
  astroImageService,
  getImage,
  imageUrl,
  nextImageLoader,
  nuxtImageProvider,
  type ImageOptions,
} from "../src/images.ts"

const base =
  "https://images.nohead.io/plain/0199f5c2-7b1e-7c3a-9d4f-2a6b8c0e1f3d/0199f5c2-8a2d-7e4b-b1c3-5d7e9f1a2b4c"
const at = (options: string) => base.replace("/plain/", `/${options}/plain/`)

describe("imageUrl", () => {
  it("writes the options before the source, and the format after it", () => {
    expect(
      imageUrl(base, {
        width: 800,
        height: 600,
        fit: "cover",
        gravity: "sm",
        dpr: 2,
        quality: 80,
        format: "webp",
        options: ["bl:2"],
      })
    ).toBe(`${at("rs:fill:800:600/g:sm/dpr:2/q:80/bl:2")}@webp`)
    expect(imageUrl({ image_url: base }, { width: 320 })).toBe(
      at("rs:fit:320:0")
    )
    expect(imageUrl(base)).toBe(base)
  })

  it("replaces a format the URL already names", () => {
    expect(imageUrl(`${base}@png`, { format: "avif" })).toBe(`${base}@avif`)
  })

  it("refuses options that would break the path", () => {
    expect(() => imageUrl(base, { gravity: "fp:0.5/0.3" })).toThrow(
      /Not an imgproxy option/
    )
    expect(() => imageUrl(base, { options: ["bl:2@x"] })).toThrow(
      /Not an imgproxy option/
    )
  })

  it("refuses an unknown fit, and takes a missing one as contain", () => {
    for (const fit of ["crop", "toString"])
      expect(() =>
        imageUrl(base, { width: 1, fit: fit as ImageOptions["fit"] })
      ).toThrow(new TypeError("fit must be one of contain, cover, fill"))
    for (const fit of [undefined, null, ""])
      expect(
        imageUrl(base, { width: 1, fit: fit as ImageOptions["fit"] })
      ).toBe(at("rs:fit:1:0"))
  })

  it("leaves empty options out", () => {
    expect(
      imageUrl(base, {
        width: 1,
        gravity: "",
        format: "" as ImageOptions["format"],
        options: ["", "bl:2"],
      })
    ).toBe(at("rs:fit:1:0/bl:2"))
  })

  it("refuses what is not a ready image's URL", () => {
    expect(() => imageUrl({ image_url: null })).toThrow(/no image_url/)
    expect(() => imageUrl("https://example.com/cat.png")).toThrow(
      /Not a Nohead image URL/
    )
  })
})

describe("framework loaders", () => {
  it("serve Next.js, Astro and Nuxt Image", () => {
    expect(nextImageLoader({ src: base, width: 640, quality: 75 })).toBe(
      at("rs:fit:640:0/q:75")
    )
    expect(
      astroImageService.getURL({
        src: base,
        width: 400,
        height: 300,
        format: "avif",
        quality: "high",
      })
    ).toBe(`${at("rs:fit:400:300")}@avif`)
    expect(
      getImage(base, {
        modifiers: { width: "200", fit: "cover", format: "webp" },
      })
    ).toEqual({ url: `${at("rs:fill:200:0")}@webp` })
    expect(nuxtImageProvider().getImage(base, { modifiers: {} })).toEqual({
      url: base,
    })
    expect(
      astroImageService.getURL({
        src: base,
        width: 300,
        height: 300,
        fit: "cover",
      })
    ).toBe(at("rs:fill:300:300"))
  })

  it("take a local image service's URLs, with their signature segment", () => {
    const local = base.replace(
      "https://images.nohead.io/",
      "http://localhost:8081/_/"
    )
    expect(nextImageLoader({ src: local, width: 64 })).toBe(
      local.replace("/_/plain/", "/_/rs:fit:64:0/plain/")
    )
  })

  it("leave the site's own images alone", () => {
    expect(nextImageLoader({ src: "/logo.png", width: 640 })).toBe("/logo.png")
    expect(
      astroImageService.getURL({ src: { src: "/_astro/logo.png" }, width: 100 })
    ).toBe("/_astro/logo.png")
    expect(getImage("https://example.com/cat.png")).toEqual({
      url: "https://example.com/cat.png",
    })
  })
})
