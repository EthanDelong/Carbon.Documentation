// Panel image fills — the per-kind emit for an ImageFill (url / sprite / png / item icon). Kept apart
// from panel.ts so the panel definition stays small and new fill kinds slot in here. The panel's
// `color` is the image tint for every kind. URL fills use the raw-image element form; sprite/png/item
// icon use the CuiPanel `Image` form (a sprite/png/item is just an Image with a different source).

import { color, cuiPanelLines, cuiRawImageLines, esc, nameRef, offExpr, parentRef, posExpr } from './emit'
import type { EmitContext } from './emit'
import type { CuiComponent, ImageFill, PanelElement } from '../types'

/**
 * AddUi wire-component types that carry an image SOURCE (sprite/png/item/url/steam avatar), as emitted
 * below. The live-preview diff (previewDiff.ts) uses these to find an image element's source-identity —
 * patching a source-type change in place (`update:true`) null-refs the client, so it must destroy +
 * recreate instead.
 */
export const IMAGE_COMPONENT_TYPE = 'UnityEngine.UI.Image'
export const RAW_IMAGE_COMPONENT_TYPE = 'UnityEngine.UI.RawImage'

/**
 * A locally-browsed preview image can't render in game by itself -- the fill still needs its real
 * server-side source. When that source is blank the generated code gets an explicit marker instead
 * of silently emitting an empty string.
 */
function missingSourceTodo(fill: ImageFill): string[] {
  if (fill.kind === 'png' && !fill.png.trim()) return ["// TODO: set the stored image's data id -- this image fill has no in-game source yet."]
  if (fill.kind === 'imagedb' && !fill.dbName.trim()) return ['// TODO: set the image DB name -- this image fill has no in-game source yet.']
  return []
}

/** Oxide CUI lines for a panel whose fill is `fill` (the panel color is the tint). */
export function oxideImageFill(el: PanelElement, ctx: EmitContext, fill: ImageFill): string[] {
  const c = color(el.props.color)
  switch (fill.kind) {
    case 'url':
      return cuiRawImageLines(el, ctx, `Url = "${esc(fill.url)}", Color = "${c}"`)
    case 'sprite':
      return cuiPanelLines(el, ctx, `Sprite = "${esc(fill.sprite)}", Color = "${c}"`)
    case 'png':
      return [...missingSourceTodo(fill), ...cuiPanelLines(el, ctx, `Png = "${esc(fill.png)}", Color = "${c}"`)]
    case 'itemicon':
      return cuiPanelLines(el, ctx, `ItemId = ${fill.itemId}, SkinId = ${fill.skinId}, Color = "${c}"`)
    case 'steamavatar':
      return cuiRawImageLines(el, ctx, `SteamId = "${esc(fill.steamId)}", Color = "${c}"`)
    case 'imagedb':
      // Oxide has no built-in image DB — reference a preloaded image by name via ImageLibrary (the
      // load itself is emitted in the plugin lifecycle). Requires the ImageLibrary plugin at runtime.
      return [...missingSourceTodo(fill), ...cuiPanelLines(el, ctx, `Png = (string)ImageLibrary?.Call("GetImage", "${esc(fill.dbName)}"), Color = "${c}"`)]
  }
}

/** Carbon LUI lines for a panel whose fill is `fill`. */
export function carbonImageFill(el: PanelElement, ctx: EmitContext, fill: ImageFill): string[] {
  const parent = esc(parentRef(el, ctx))
  const name = esc(nameRef(el, ctx))
  const c = color(el.props.color)
  const pos = posExpr(el)
  const off = offExpr(el)
  switch (fill.kind) {
    case 'url':
      return [`cui.v2.CreateUrlImage("${parent}",`, `    ${pos},`, `    ${off},`, `    "${esc(fill.url)}", "${c}", "${name}");`, '']
    case 'sprite':
      return [`cui.v2.CreateSprite("${parent}",`, `    ${pos},`, `    ${off},`, `    "${esc(fill.sprite)}", "${c}", "${name}");`, '']
    case 'png':
      return [...missingSourceTodo(fill), `cui.v2.CreateImage("${parent}",`, `    ${pos},`, `    ${off},`, `    "${esc(fill.png)}", "${c}", "${name}");`, '']
    case 'itemicon':
      // CreateItemIcon(parent, pos, offset, itemId, skinId, color, name) — the color arg (tint) sits
      // BEFORE name; omitting it puts the name in the color slot and produces an invalid color.
      return [`cui.v2.CreateItemIcon("${parent}",`, `    ${pos},`, `    ${off},`, `    ${fill.itemId}, ${fill.skinId}, "${c}", "${name}");`, '']
    case 'steamavatar':
      return [`cui.v2.CreateSteamAvatar("${parent}",`, `    ${pos},`, `    ${off},`, `    "${esc(fill.steamId)}", "${c}", "${name}");`, '']
    case 'imagedb':
      return [...missingSourceTodo(fill), `cui.v2.CreateImageFromDb("${parent}",`, `    ${pos},`, `    ${off},`, `    "${esc(fill.dbName)}", "${c}", "${name}");`, '']
  }
}

/** AddUi wire component for a panel whose fill is `fill` (with the tint `colorStr`). */
export function adduiImageFill(fill: ImageFill, colorStr: string): CuiComponent {
  switch (fill.kind) {
    case 'url':
      return { type: 'UnityEngine.UI.RawImage', url: fill.url, color: colorStr }
    case 'sprite':
      return { type: 'UnityEngine.UI.Image', color: colorStr, sprite: fill.sprite }
    case 'png':
      return { type: 'UnityEngine.UI.Image', color: colorStr, png: fill.png }
    case 'itemicon':
      // Match Carbon LUI's serialization: skinid is written ONLY when non-zero. Sending skinid:0 makes
      // the client attempt a skin-0 lookup and null-ref in AddUi (crashes the connection); omit it.
      return { type: 'UnityEngine.UI.Image', color: colorStr, itemid: fill.itemId, ...(fill.skinId ? { skinid: fill.skinId } : {}) }
    case 'steamavatar':
      return { type: 'UnityEngine.UI.RawImage', steamid: fill.steamId, color: colorStr }
    case 'imagedb':
      // No concrete stored-image id at author time — preview/JSON render from the preload url so the
      // image still shows; the generated Class/UX code uses the proper image-DB reference instead.
      return { type: 'UnityEngine.UI.RawImage', url: fill.url, color: colorStr }
  }
}
