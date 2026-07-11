<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import {
  applyResize,
  clamp01,
  clampPatchToParent,
  cssColor,
  resizeEdgeMask,
  rootRect,
  snapAndAlignMove,
  snapResizePatch,
  type OffsetPatch,
  type ResizeEdge,
} from './geometry'
import { layoutSlot } from './elements/container'
import { definitionOf } from './elements/registry'
import { applyItemBindings, fontDef, resolveText } from './types'
import type { ColorRGBA, DesignerElement, Rect, TextAlign, TextFont } from './types'
import { beginActiveDrag } from './useActiveDrag'
import { useDesigner } from './useDesigner'
import { useItemCatalog } from './useItemCatalog'
import { useLocalImages } from './useLocalImages'

defineOptions({ name: 'CanvasElement' })

const props = defineProps<{
  element: DesignerElement
  /** parent's CUI width/height (root canvas dims for top-level elements) */
  parentW: number
  parentH: number
  /** on-screen px per CUI px */
  scale: number
}>()

const {
  selectedId,
  selectedIds,
  isSelected: isSelectedFn,
  select,
  surfaceOf,
  groupMembersOf,
  update,
  childrenOf,
  byId,
  gridSize,
  constrain,
  openContextMenu,
  canvas,
  rectOf,
  setGuides,
  clearGuides,
  dataSources,
  inlineEditId,
  repeatSourceOf,
  layoutOf,
} = useDesigner()

// Item-icon fills preview via the CDN inventory icons (same source as the item references pages).
const { ensureLoaded: ensureItemCatalog, iconUrlById } = useItemCatalog()
ensureItemCatalog()

// Stored-image fills (png / imagedb) can carry a locally-browsed preview image.
const { getLocalImage } = useLocalImages()

// Inside a repeating template the canvas shows ROW 0's values on the real elements (the ghosts show
// the later rows) — so an item-bound element previews data, not its literal placeholder.
const rowZeroElement = computed<DesignerElement>(() => {
  const el = props.element
  if (!el.itemBindings) return el
  const ds = repeatSourceOf(el.id)
  return ds?.items.length ? applyItemBindings(el, ds.items[0]) : el
})

const isSelected = computed(() => isSelectedFn(props.element.id)) // any selection (outline)
const single = computed(() => selectedId.value === props.element.id) // only this one (chrome)

// Resolve this element's local rect relative to the parent's content box.
const metrics = computed(() => {
  const el = props.element
  const left = el.anchorMin.x * props.parentW + el.offsetMin.x
  const right = el.anchorMax.x * props.parentW + el.offsetMax.x
  const bottom = el.anchorMin.y * props.parentH + el.offsetMin.y
  const top = el.anchorMax.y * props.parentH + el.offsetMax.y
  return { left, right, bottom, top, cuiW: right - left, cuiH: top - bottom }
})

// Geometry only (position + size). The visual fill lives on a separate `.ld-el-fill` layer (below)
// so the "Layout opacity" compositing control (#7) can fade fills/text/borders without dimming the
// selection chrome — handles stay crisp even at 0% so boxes can be placed against the real game.
const boxStyle = computed(() => {
  const m = metrics.value
  return {
    left: `${m.left * props.scale}px`,
    top: `${(props.parentH - m.top) * props.scale}px`, // flip y
    width: `${m.cuiW * props.scale}px`,
    height: `${m.cuiH * props.scale}px`,
  }
})

// Fill paint for the box: panels/buttons paint a background color. A panel with an image fill
// renders through fillImage instead -- in game the color tints the image itself, there is no
// backdrop behind it. Text boxes and empty containers stay transparent (invisible in-game) ->
// null, no fill layer.
const fillStyle = computed<Record<string, string> | null>(() => {
  const el = rowZeroElement.value
  if (el.type === 'panel') {
    if (fillImage.value) return null
    return { backgroundColor: cssColor(el.props.color) }
  }
  if (el.type === 'button') {
    // a tab-switch button previews its active color while its page is the active one
    const sw = el.props.tabSwitch
    if (sw && el.props.activeColor) {
      const tv = byId.value.get(sw.target)
      if (tv?.type === 'tabs' && tv.props.activeTab === sw.page) return { backgroundColor: cssColor(el.props.activeColor) }
    }
    return { backgroundColor: cssColor(el.props.color) }
  }
  return null
})

// Image fill (URL image or item icon). The game's color multiplies the texture per channel
// (black = silhouette, white = untinted) and its alpha scales the texture's alpha. An SVG
// feColorMatrix filter reproduces that exactly: it runs on non-premultiplied pixels, so
// semi-transparent texels (soft shadows) keep their hue. color-interpolation-filters="sRGB" is
// required -- the SVG default (linearRGB) renders lighter than the game. Item icons render
// contained (the game doesn't stretch them); unknown ids fall back to the plain color fill.
type ImageFill = { url: string; fit: 'stretch' | 'icon'; tint: { r: number; g: number; b: number } | null; alpha: number }
const fillImage = computed<ImageFill | null>(() => {
  const el = rowZeroElement.value
  if (el.type !== 'panel') return null
  const img = el.props.image
  let url: string | null = null
  let fit: 'stretch' | 'icon' = 'stretch'
  // A locally-browsed preview image wins over the imagedb preload URL (it is the more deliberate
  // stand-in); design-time only -- the generated output renders from the fill's real source.
  const local = img && (img.kind === 'png' || img.kind === 'imagedb') ? getLocalImage(img.previewImage) : null
  if (local) {
    url = local.dataUrl
  } else if (img?.url) {
    url = img.url
  } else if (img?.kind === 'itemicon') {
    url = iconUrlById(img.itemId) ?? null
    fit = 'icon'
  }
  if (!url) return null
  return { url, fit, tint: tintRgb(el.props.color), alpha: clamp01(el.props.color.a) }
})

// null for pure white (identity multiply) so the untinted common case skips tinting entirely
function tintRgb(c: ColorRGBA): { r: number; g: number; b: number } | null {
  const r = clamp01(c.r)
  const g = clamp01(c.g)
  const b = clamp01(c.b)
  return r === 1 && g === 1 && b === 1 ? null : { r, g, b }
}

/** feColorMatrix rows for the multiply: out.rgb = tex.rgb * tint.rgb, alpha untouched. */
function tintMatrix(t: { r: number; g: number; b: number }): string {
  return `${t.r} 0 0 0 0  0 ${t.g} 0 0 0  0 0 ${t.b} 0 0  0 0 0 1 0`
}

// Border preview. Rendered as a separate overlay AFTER the children (see template) so it paints on
// top of them — matching the game, where the border = four edge subpanels appended as the panel's
// last children. Inset box-shadow draws the frame over the edges only (no mesh on a translucent
// panel); pointer-events off so it never blocks dragging. Scales with the canvas.
const borderOverlay = computed(() => {
  const el = props.element
  if (el.type !== 'panel' || !el.props.border || el.props.border.width <= 0) return null
  return { boxShadow: `inset 0 0 0 ${el.props.border.width * props.scale}px ${cssColor(el.props.border.color)}` }
})

// Map a Unity TextAnchor (Upper/Middle/Lower × Left/Center/Right) to flexbox + text-align.
function alignParts(a: TextAlign): { vert: string; horiz: string; textAlign: string } {
  const vert = a.startsWith('Upper') ? 'flex-start' : a.startsWith('Lower') ? 'flex-end' : 'center'
  const horiz = a.endsWith('Left') ? 'flex-start' : a.endsWith('Right') ? 'flex-end' : 'center'
  const textAlign = a.endsWith('Left') ? 'left' : a.endsWith('Right') ? 'right' : 'center'
  return { vert, horiz, textAlign }
}

// Elements that render text in their box (share content + fontSize + font + align props).
const TEXTY = new Set(['text', 'input', 'countdown'])
const isTexty = computed(() => TEXTY.has(props.element.type))

// Inner text-node style (text/input/countdown). Font size scales with the canvas like offsets do.
const textStyle = computed<Record<string, string> | null>(() => {
  const el = props.element
  if (!TEXTY.has(el.type)) return null
  const p = el.props as { align: TextAlign; font?: TextFont; color: ColorRGBA; fontSize: number }
  const a = alignParts(p.align)
  const f = fontDef(p.font)
  return {
    alignItems: a.vert,
    justifyContent: a.horiz,
    textAlign: a.textAlign,
    color: cssColor(p.color),
    fontSize: `${p.fontSize * props.scale}px`,
    fontFamily: f.css,
    fontWeight: String(f.weight ?? 400),
  }
})
// What to show in the box: a bound text resolves through its data source; input/countdown show their
// own literal text (input's initial value, countdown's %TIME_LEFT% template).
const textContent = computed(() => {
  const el = rowZeroElement.value
  if (el.type === 'text') return resolveText(el, dataSources.value)
  if (el.type === 'input' || el.type === 'countdown') return el.props.text
  return ''
})

const children = computed(() => {
  const el = props.element
  const kids = childrenOf(el.id)
  // A tab view renders only its ACTIVE page — switch via the Inspector or by double-clicking a
  // tab-switch button on the canvas.
  if (el.type === 'tabs' && kids.length) {
    const i = Math.min(Math.max(el.props.activeTab, 0), kids.length - 1)
    return [kids[i]]
  }
  return kids
})

// --- repeat ghosts ---------------------------------------------------------------------------------
// A repeating layout container renders its template once as REAL (editable) children in slot 0, and
// paints rows 1..N as flat, non-interactive ghost boxes in the following slots: pure translations of
// the template's boxes with each row's bound values applied (applyItemBindings — the same resolver
// codegen uses, so a slot previews exactly what that row emits). Ghosts are synthetic, not elements:
// there is exactly one thing to edit and N things rendered.

/** A scrolling layout container clips its children on canvas, matching the in-game viewport. */
const isScrollViewport = computed(() => {
  const el = props.element
  return el.type === 'container' && !!el.props.layout?.scroll
})

/** The repeated list's rows when this element is a repeating layout container, else null. */
const repeatRows = computed(() => {
  const el = props.element
  if (el.type !== 'container' || !el.props.layout || !el.repeat?.source) return null
  const ds = dataSources.value.find((d) => d.id === el.repeat!.source)
  return ds?.kind === 'list' ? ds.items : null
})

type GhostBox = {
  key: string
  x: number // container-local CUI px, top-left origin
  y: number
  w: number
  h: number
  fill: string | null
  imageUrl: string | null
  /** 'stretch' for url images, 'icon' (contain, centered) for item icons. */
  imageFit: 'stretch' | 'icon'
  /** multiply tint over the image (see fillImage); null = untinted */
  imageTint: { r: number; g: number; b: number } | null
  imageAlpha: number
  text: string | null
  textStyle: Record<string, string> | null
}

const ghostBoxes = computed<GhostBox[]>(() => {
  const el = props.element
  const rows = repeatRows.value
  if (!rows || el.type !== 'container' || !el.props.layout) return []
  const template = childrenOf(el.id)[0]
  if (!template) return []
  const l = el.props.layout
  // Flatten the template subtree into container-local boxes (same anchor math as `metrics`).
  const flat: { el: DesignerElement; x: number; y: number; w: number; h: number }[] = []
  const walk = (node: DesignerElement, ox: number, oy: number, pw: number, ph: number) => {
    const left = node.anchorMin.x * pw + node.offsetMin.x
    const right = node.anchorMax.x * pw + node.offsetMax.x
    const bottom = node.anchorMin.y * ph + node.offsetMin.y
    const top = node.anchorMax.y * ph + node.offsetMax.y
    const f = { el: node, x: ox + left, y: oy + (ph - top), w: right - left, h: top - bottom }
    flat.push(f)
    for (const kid of childrenOf(node.id)) walk(kid, f.x, f.y, f.w, f.h)
  }
  walk(template, 0, 0, metrics.value.cuiW, metrics.value.cuiH)

  const slot0 = layoutSlot(l, 0)
  const out: GhostBox[] = []
  for (let i = 1; i < rows.length; i++) {
    const slot = layoutSlot(l, i)
    const dx = slot.offsetMin.x - slot0.offsetMin.x
    const dy = -(slot.offsetMax.y - slot0.offsetMax.y) // slot offsets are CUI y-up; screen y is down
    for (const f of flat) {
      const g = applyItemBindings(f.el, rows[i])
      const texty = TEXTY.has(g.type)
      const p = g.props as { color?: ColorRGBA; image?: { kind: string; url?: string; itemId?: number; previewImage?: string }; align?: TextAlign; font?: TextFont; fontSize?: number; text?: string }
      let textStyle: Record<string, string> | null = null
      if (texty && p.align && p.color && p.fontSize) {
        const a = alignParts(p.align)
        const fd = fontDef(p.font)
        textStyle = {
          alignItems: a.vert,
          justifyContent: a.horiz,
          textAlign: a.textAlign,
          color: cssColor(p.color),
          fontSize: `${p.fontSize * props.scale}px`,
          fontFamily: fd.css,
          fontWeight: String(fd.weight ?? 400),
        }
      }
      const imageUrl =
        g.type === 'panel' && p.image?.previewImage && getLocalImage(p.image.previewImage)
          ? getLocalImage(p.image.previewImage)!.dataUrl
          : g.type === 'panel' && p.image?.kind === 'url' && p.image.url
            ? p.image.url
            : g.type === 'panel' && p.image?.kind === 'itemicon'
              ? iconUrlById(p.image.itemId ?? 0)
              : null
      out.push({
        key: `${g.id}.${i}`,
        x: f.x + dx,
        y: f.y + dy,
        w: f.w,
        h: f.h,
        // with an image fill the color tints the image (fillImage) instead of painting a backdrop
        fill: (g.type === 'panel' || g.type === 'button') && p.color && !imageUrl ? cssColor(p.color) : null,
        imageUrl,
        imageFit: p.image?.kind === 'itemicon' ? 'icon' : 'stretch',
        imageTint: imageUrl && p.color ? tintRgb(p.color) : null,
        imageAlpha: imageUrl && p.color ? clamp01(p.color.a) : 1,
        text: texty ? (g.type === 'text' ? resolveText(g, dataSources.value) : (p.text ?? '')) : null,
        textStyle,
      })
    }
  }
  return out
})

function ghostStyle(g: GhostBox): Record<string, string> {
  const s = props.scale
  const style: Record<string, string> = {
    left: `${g.x * s}px`,
    top: `${g.y * s}px`,
    width: `${g.w * s}px`,
    height: `${g.h * s}px`,
  }
  if (g.fill) style.backgroundColor = g.fill
  return style
}

// --- inline text editing (double-click) ------------------------------------------------------------
// Double-click edits text in place: a texty element edits itself; a container (button, panel) opens
// the editor on its first text child — the caption, same resolution as the context menu's "Edit label
// text". Bound text is driven by its data source, so it isn't editable here.
const editing = computed(() => inlineEditId.value === props.element.id)
const editBox = ref<HTMLTextAreaElement | null>(null)
watch(editing, (on) => {
  if (on)
    nextTick(() => {
      editBox.value?.focus()
      editBox.value?.select()
    })
})

function onDblClick(e: MouseEvent) {
  e.stopPropagation()
  const el = props.element
  // Double-clicking a tab-switch button previews its page — including through its full-bleed
  // caption, which is what the pointer usually lands on. (Edit that caption via Alt-click.)
  const switchHost = el.type === 'button' ? el : el.passthrough && el.parentId ? byId.value.get(el.parentId) : null
  if (switchHost?.type === 'button' && switchHost.props.tabSwitch) {
    const tv = byId.value.get(switchHost.props.tabSwitch.target)
    if (tv?.type === 'tabs') update(tv.id, { props: { activeTab: switchHost.props.tabSwitch.page } })
    return
  }
  const target = TEXTY.has(el.type) ? el : (childrenOf(el.id).find((k) => k.type === 'text') ?? null)
  if (!target || target.bindings?.text || target.itemBindings?.text) return // bound text: edit the source/list instead
  select(target.id)
  inlineEditId.value = target.id
}

function commitInlineEdit() {
  if (!editing.value) return // Enter already committed; this is the unmount blur
  if (editBox.value) update(props.element.id, { props: { text: editBox.value.value } })
  inlineEditId.value = null
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    commitInlineEdit()
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    inlineEditId.value = null // discard the draft
  }
}

// Anchor markers: the rectangle (within the parent) that this element is anchored to.
// Positions are expressed relative to this element's own box (the anchor point is exactly
// -offset away from the matching edge), so they can sit outside the box when stretched.
const anchorMarkers = computed(() => {
  const m = metrics.value
  const s = props.scale
  const Wd = m.cuiW * s
  const Hd = m.cuiH * s
  const el = props.element
  const xA = -el.offsetMin.x * s // anchorMin.x
  const xB = Wd - el.offsetMax.x * s // anchorMax.x
  const yTop = el.offsetMax.y * s // anchorMax.y (top, since CUI y is up)
  const yBot = Hd + el.offsetMin.y * s // anchorMin.y (bottom)
  return {
    rect: {
      left: `${Math.min(xA, xB)}px`,
      top: `${Math.min(yTop, yBot)}px`,
      width: `${Math.abs(xB - xA)}px`,
      height: `${Math.abs(yBot - yTop)}px`,
    },
    corners: [
      { left: `${xA}px`, top: `${yTop}px` },
      { left: `${xB}px`, top: `${yTop}px` },
      { left: `${xA}px`, top: `${yBot}px` },
      { left: `${xB}px`, top: `${yBot}px` },
    ],
  }
})

// --- drag / resize -------------------------------------------------------------------

function cloneEl(el: DesignerElement): DesignerElement {
  return {
    ...el,
    anchorMin: { ...el.anchorMin },
    anchorMax: { ...el.anchorMax },
    offsetMin: { ...el.offsetMin },
    offsetMax: { ...el.offsetMax },
    props: definitionOf(el).cloneProps(el),
  } as DesignerElement
}

// `parentRect` is each member's parent rect snapshot, captured at drag start so the per-frame move
// path never re-reads rectOf for clamping (parents don't move during the drag → dims are invariant).
type GroupItem = { id: string; snap: DesignerElement; parentRect: Rect | null }
// `snapshot` is the drag SUBJECT (the element actually being moved/resized) — for a move inside a group
// that's the group, not the clicked child — and parentW/H are the subject's parent dims.
// `parentRect`/`alignX`/`alignY` are captured ONCE in startMove (E6): the subject's parent rect and the
// sibling alignment-guide candidates don't change during a same-parent move, so rebuilding them every
// pointermove (allocating 3 coords per sibling per axis + re-reading rectOf) was pure waste.
type Drag = {
  // 'blocked' = a slotted layout child being "moved": selection worked, but position is slot-managed,
  // so the drag does nothing except surface a hint once the pointer actually travels.
  mode: 'move' | 'resize' | 'blocked'
  edge?: ResizeEdge
  startX: number
  startY: number
  snapshot: DesignerElement
  parentW: number
  parentH: number
  group?: GroupItem[]
  parentRect: Rect | null
  alignX: number[]
  alignY: number[]
}
const drag = ref<Drag | null>(null)

// Ordered (top → bottom) list of element ids under a screen point — the canvas's z-stack at that spot.
// Lets Alt-click reach a box hidden beneath a full-bleed sibling (a plain click only ever hits the top).
function elementsUnderPoint(clientX: number, clientY: number): string[] {
  const ids: string[] = []
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const id = node instanceof HTMLElement ? node.dataset.elId : undefined
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function startMove(e: PointerEvent) {
  e.stopPropagation()
  // Alt-click drills DOWN the z-stack at the cursor: each Alt-click selects the next element below the
  // current one (wrapping), so an occluded box is reachable on the canvas. Once selected it floats above
  // its siblings (.selected z-index), so it can then be dragged normally. No drag starts on this click.
  if (e.altKey) {
    const stack = elementsUnderPoint(e.clientX, e.clientY)
    if (stack.length) {
      const idx = selectedId.value ? stack.indexOf(selectedId.value) : -1
      select(stack[(idx + 1) % stack.length])
    }
    return
  }
  // A full-bleed child (e.g. a label filling its button) defers to its parent, and the click then acts
  // on the whole group the target belongs to. Alt-click (above) bypasses both to reach the raw element.
  const subjectId = surfaceOf(props.element.id)
  const members = groupMembersOf(subjectId)
  const additive = e.shiftKey || e.ctrlKey || e.metaKey
  if (additive) {
    const allSel = members.every((m) => selectedIds.value.includes(m))
    selectedIds.value = allSel ? selectedIds.value.filter((id) => !members.includes(id)) : [...new Set([...selectedIds.value, ...members])]
    return // toggle selection, no drag
  }
  if (!members.every((m) => selectedIds.value.includes(m))) selectedIds.value = members
  const subject = byId.value.get(subjectId) ?? props.element
  // A slotted layout child selects normally but can't be dragged — its position is slot-managed
  // (moving it free would just snap back on the next reflow). The drag becomes a hint instead;
  // resizing stays allowed and writes the container's item size (see endDrag).
  if (subject.parentId && layoutOf(subject.parentId)) {
    drag.value = { mode: 'blocked', startX: e.clientX, startY: e.clientY, snapshot: cloneEl(subject), parentW: props.parentW, parentH: props.parentH, parentRect: null, alignX: [], alignY: [] }
    beginDrag()
    return
  }
  const ids = selectedIds.value.slice()
  const group = ids
    .map((id) => {
      const el = byId.value.get(id)
      // Snapshot each member's parent rect now (invariant during the drag) so per-frame clamping in
      // the move handler never has to re-read rectOf (E4/E6).
      return el ? { id, snap: cloneEl(el), parentRect: (el.parentId ? rectOf(el.parentId) : rootRect(canvas)) ?? null } : null
    })
    .filter((g): g is GroupItem => !!g)
  const pr = subject.parentId ? rectOf(subject.parentId) : rootRect(canvas)
  // Sibling alignment-guide candidates in parent-local coords — built ONCE here, not every pointermove
  // (E6): siblings and their rects don't move during a same-parent drag. Same computation as the old
  // per-frame loop, so guide positions are byte-for-byte identical.
  const alignX: number[] = []
  const alignY: number[] = []
  if (pr) {
    for (const sib of childrenOf(subject.parentId)) {
      if (sib.id === subject.id) continue
      const sr = rectOf(sib.id)
      if (!sr) continue
      const lx = sr.x - pr.x
      const rx = lx + sr.w
      const by = sr.y - pr.y
      const ty = by + sr.h
      alignX.push(lx, (lx + rx) / 2, rx)
      alignY.push(by, (by + ty) / 2, ty)
    }
  }
  drag.value = {
    mode: 'move',
    startX: e.clientX,
    startY: e.clientY,
    snapshot: cloneEl(subject),
    parentW: pr?.w ?? props.parentW,
    parentH: pr?.h ?? props.parentH,
    group,
    parentRect: pr ?? null,
    alignX,
    alignY,
  }
  beginDrag()
}

function startResize(e: PointerEvent, edge: ResizeEdge) {
  e.stopPropagation()
  select(props.element.id)
  // Resize reads only the startResize snapshot per frame (no rectOf), so no extra snapshots needed.
  drag.value = { mode: 'resize', edge, startX: e.clientX, startY: e.clientY, snapshot: cloneEl(props.element), parentW: props.parentW, parentH: props.parentH, parentRect: null, alignX: [], alignY: [] }
  beginDrag()
}

function onDragMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  if (d.mode === 'blocked') {
    // Show the hint once they've actually tried to move it (not on a plain click).
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 6) moveHint.value = true
    return
  }
  const dxCui = (e.clientX - d.startX) / props.scale
  const dyCui = -(e.clientY - d.startY) / props.scale // screen y is down; CUI y is up
  let patch: OffsetPatch | null = null
  if (d.mode === 'move') {
    const threshold = 6 / props.scale // ~6 screen px
    const pg = d.parentRect // snapshot from startMove (invariant during the drag)
    const res = snapAndAlignMove(d.snapshot, dxCui, dyCui, d.parentW, d.parentH, gridSize.value, threshold, d.alignX, d.alignY)
    patch = { offsetMin: res.offsetMin, offsetMax: res.offsetMax }
    if (constrain.value) patch = clampPatchToParent(d.snapshot, patch, d.parentW, d.parentH, true)
    const v = res.guideX !== null && pg ? { x: pg.x + res.guideX, y0: pg.y, y1: pg.y + d.parentH } : null
    const h = res.guideY !== null && pg ? { y: pg.y + res.guideY, x0: pg.x, x1: pg.x + d.parentW } : null
    setGuides(v, h)
    // move the rest of the selection by the same applied delta (clamped per their own parent)
    if (d.group && d.group.length > 1) {
      const ddx = patch.offsetMin.x - d.snapshot.offsetMin.x
      const ddy = patch.offsetMin.y - d.snapshot.offsetMin.y
      for (const g of d.group) {
        if (g.id === d.snapshot.id) continue
        let gp: OffsetPatch = {
          offsetMin: { x: g.snap.offsetMin.x + ddx, y: g.snap.offsetMin.y + ddy },
          offsetMax: { x: g.snap.offsetMax.x + ddx, y: g.snap.offsetMax.y + ddy },
        }
        if (constrain.value) {
          const ppr = g.parentRect // snapshot from startMove (dims invariant during the drag)
          if (ppr) gp = clampPatchToParent(g.snap, gp, ppr.w, ppr.h, true)
        }
        update(g.id, gp)
      }
    }
  } else if (d.edge) {
    // Snap only the edges this handle moved (Alt mirrors, so both edges of a touched axis) — snapping
    // the stationary edges would walk them onto the grid and make the element creep across resizes.
    const edges = resizeEdgeMask(d.edge, e.altKey)
    patch = snapResizePatch(applyResize(d.snapshot, d.parentW, d.parentH, d.edge, dxCui, dyCui, e.altKey), gridSize.value, edges)
    if (constrain.value && !e.altKey) patch = clampPatchToParent(d.snapshot, patch, d.parentW, d.parentH, false)
  }
  if (patch) update(d.snapshot.id, patch)
}

// One shared window pointermove/pointerup routes here (E2); begin on pointerdown, end on pointerup.
let stopActiveDrag: (() => void) | null = null

function beginDrag() {
  stopActiveDrag = beginActiveDrag({ move: onDragMove, up: endDrag })
}

const moveHint = ref(false)

function endDrag() {
  const d = drag.value
  // Resizing a slotted child edits the TEMPLATE's slot: the final size becomes the container
  // layout's item size, and the ensuing reflow snaps every slot (and ghost) to match.
  if (d?.mode === 'resize') {
    const l = props.element.parentId ? layoutOf(props.element.parentId) : null
    if (l) {
      const m = metrics.value
      update(props.element.parentId!, { props: { layout: { ...l, itemWidth: Math.max(1, Math.round(m.cuiW)), itemHeight: Math.max(1, Math.round(m.cuiH)) } } })
    }
  }
  if (d) clearGuides()
  moveHint.value = false
  drag.value = null
  stopActiveDrag?.()
  stopActiveDrag = null
}

function onContextMenu(e: MouseEvent) {
  // Right-click climbs passthrough captions to their host but NOT tab pages — the menu on a page
  // must belong to the page (its Add child fills the page), not to the view around it.
  let cur = props.element.id
  let el = byId.value.get(cur)
  while (el?.passthrough && el.parentId) {
    cur = el.parentId
    el = byId.value.get(cur)
  }
  openContextMenu(cur, e.clientX, e.clientY, elementsUnderPoint(e.clientX, e.clientY))
}

// If this element unmounts mid-drag (e.g. deleted, or its subtree re-parented) tear the drag down so
// the shared listeners don't stay attached routing to a dead closure, and any live guide is cleared.
onUnmounted(() => {
  if (stopActiveDrag) endDrag()
})

const HANDLES: { edge: ResizeEdge; cls: string; cursor: string }[] = [
  { edge: 'nw', cls: 'h-nw', cursor: 'nwse-resize' },
  { edge: 'n', cls: 'h-n', cursor: 'ns-resize' },
  { edge: 'ne', cls: 'h-ne', cursor: 'nesw-resize' },
  { edge: 'e', cls: 'h-e', cursor: 'ew-resize' },
  { edge: 'se', cls: 'h-se', cursor: 'nwse-resize' },
  { edge: 's', cls: 'h-s', cursor: 'ns-resize' },
  { edge: 'sw', cls: 'h-sw', cursor: 'nesw-resize' },
  { edge: 'w', cls: 'h-w', cursor: 'ew-resize' },
]
</script>

<template>
  <div
    class="ld-element"
    :class="{ selected: isSelected }"
    :style="boxStyle"
    :data-el-id="element.id"
    :title="`${element.name} — drag to move, drag a handle to resize, Alt-click to reach what's underneath, right-click for options`"
    @pointerdown="startMove"
    @dblclick="onDblClick"
    @contextmenu.prevent.stop="onContextMenu"
  >
    <!-- fill layer (behind everything): faded by the Layout-opacity control, so handles stay crisp -->
    <div v-if="fillStyle" class="ld-el-fill" :style="fillStyle" />
    <div v-else-if="fillImage" class="ld-el-fill ld-fill-img" :style="{ opacity: `calc(${fillImage.alpha} * var(--ld-layout-opacity, 1))` }">
      <svg v-if="fillImage.tint" class="ld-tint-defs" aria-hidden="true">
        <filter :id="`ld-tint-${element.id}`" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" :values="tintMatrix(fillImage.tint)" />
        </filter>
      </svg>
      <img
        class="ld-fill-tex"
        :src="fillImage.url"
        :style="{ objectFit: fillImage.fit === 'icon' ? 'contain' : 'fill', filter: fillImage.tint ? `url(#ld-tint-${element.id})` : '' }"
        alt=""
        draggable="false"
      />
    </div>

    <!-- text content (text / input / countdown); pointer-events off so the box stays draggable.
         While inline-editing (double-click) it swaps for a same-styled textarea; Enter commits. -->
    <textarea
      v-if="editing"
      ref="editBox"
      class="ld-text ld-text-edit"
      :style="textStyle ?? undefined"
      :value="textContent"
      spellcheck="false"
      @pointerdown.stop
      @dblclick.stop
      @keydown="onEditKeydown"
      @blur="commitInlineEdit"
    />
    <div v-else-if="isTexty" class="ld-text" :style="textStyle ?? undefined">{{ textContent }}</div>

    <!-- selection chrome (full chrome only for a single selection) -->
    <span v-if="single" class="ld-name-tag">{{ element.name }}</span>
    <div v-if="moveHint" class="ld-move-hint">
      Part of a layout — items are arranged automatically.<br />
      Resize to change the item size; use the container's Gap / Pad controls for spacing, and the element tree to reorder.
    </div>
    <template v-if="single">
      <!-- anchor markers: where this box is pinned within its parent -->
      <div class="ld-anchor-rect" :style="anchorMarkers.rect" />
      <span v-for="(c, i) in anchorMarkers.corners" :key="`a${i}`" class="ld-anchor-marker" :style="c" />
      <span
        v-for="h in HANDLES"
        :key="h.edge"
        class="ld-handle"
        :class="h.cls"
        :style="{ cursor: h.cursor }"
        @pointerdown="startResize($event, h.edge)"
      />
    </template>

    <!-- children render inside, relative to this element's box. A scroll container clips them to
         the viewport like the game does (the wrapper carries overflow, not the box itself, so the
         name tag / handles at negative offsets stay visible). -->
    <div class="ld-children" :class="{ 'ld-clip': isScrollViewport }">
      <CanvasElement
        v-for="child in children"
        :key="child.id"
        :element="child"
        :parent-w="metrics.cuiW"
        :parent-h="metrics.cuiH"
        :scale="scale"
      />

      <!-- repeat ghosts: rows 1..N stamped from the template into the next slots (see ghostBoxes) -->
      <div v-if="ghostBoxes.length" class="ld-ghosts">
        <div v-for="g in ghostBoxes" :key="g.key" class="ld-ghost" :style="ghostStyle(g)">
          <div v-if="g.imageUrl" class="ld-fill-img" :style="{ opacity: g.imageAlpha }">
            <svg v-if="g.imageTint" class="ld-tint-defs" aria-hidden="true">
              <filter :id="`ld-tint-${g.key}`" color-interpolation-filters="sRGB">
                <feColorMatrix type="matrix" :values="tintMatrix(g.imageTint)" />
              </filter>
            </svg>
            <img
              class="ld-fill-tex"
              :src="g.imageUrl"
              :style="{ objectFit: g.imageFit === 'icon' ? 'contain' : 'fill', filter: g.imageTint ? `url(#ld-tint-${g.key})` : '' }"
              alt=""
              draggable="false"
            />
          </div>
          <div v-if="g.text !== null" class="ld-text" :style="g.textStyle ?? undefined">{{ g.text }}</div>
        </div>
      </div>
    </div>
    <span v-if="repeatRows" class="ld-repeat-badge" :title="`Repeating: the first child is the template (row 0); ${repeatRows.length - 1} more row(s) render as ghosts`">×{{ repeatRows.length }}</span>

    <!-- scroll gutters: a hint that this container is a scroll viewport (content clips + scrolls in-game) -->
    <template v-if="element.type === 'container' && element.props.layout?.scroll">
      <div v-if="element.props.layout.scroll !== 'horizontal'" class="ld-scroll-gutter ld-scroll-gutter-v" />
      <div v-if="element.props.layout.scroll !== 'vertical'" class="ld-scroll-gutter ld-scroll-gutter-h" />
    </template>

    <!-- border overlay LAST so it paints over the children (matches the in-game edge subpanels) -->
    <div v-if="borderOverlay" class="ld-border-overlay" :style="borderOverlay" />
  </div>
</template>

<style scoped>
/* --ld-layout-opacity (0..1, set on the frame, default 1) fades the DESIGN — fills, text, borders and
   the wireframe outline — over a screen-share backdrop, while selection chrome stays crisp (#7). */
.ld-el-fill {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--ld-layout-opacity, 1);
}

.ld-border-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--ld-layout-opacity, 1);
}

/* image fill (fillImage): <img> texture, tinted via the sibling <svg> feColorMatrix filter */
.ld-fill-img {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.ld-fill-tex {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* filter definition carrier -- must be rendered (not display:none) for url(#...) to resolve */
.ld-tint-defs {
  position: absolute;
  width: 0;
  height: 0;
}

.ld-element {
  position: absolute;
  box-sizing: border-box;
  /* wireframe hairline — alpha tracks the layout-opacity var so boxes vanish at 0% (calc in the
     alpha channel), leaving only the selected box's chrome visible over the real game. */
  outline: 1px solid rgb(255 255 255 / calc(0.12 * var(--ld-layout-opacity, 1)));
  user-select: none;
  touch-action: none;
}

.ld-element.selected {
  outline: 1.5px solid var(--c-carbon-1);
  z-index: 1;
}

/* inner text node for text elements — fills the box, alignment/color/size come from :style */
.ld-text {
  position: absolute;
  inset: 0;
  display: flex;
  overflow: hidden;
  padding: 0;
  line-height: 1.1;
  white-space: pre-wrap;
  word-break: break-word;
  pointer-events: none;
  opacity: var(--ld-layout-opacity, 1);
  font-family: 'Roboto Condensed', system-ui, sans-serif;
}

/* the inline editor keeps .ld-text's metrics (position/font/align) but is interactive; the dashed
   outline marks it as a draft until Enter/blur commits (Esc discards) */
.ld-text-edit {
  pointer-events: auto;
  background: rgb(0 0 0 / 0.4);
  border: none;
  outline: 1px dashed var(--c-carbon-1);
  resize: none;
  overflow: hidden;
  margin: 0;
}

/* ghost instances of a repeating template — pure visual stamps, never interactive */
.ld-ghosts {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--ld-layout-opacity, 1);
}

.ld-ghost {
  position: absolute;
  outline: 1px dashed rgb(255 255 255 / calc(0.18 * var(--ld-layout-opacity, 1)));
}

/* children pass-through wrapper; carries the scroll-viewport clip so the box's own chrome
   (name tag, handles at negative offsets) stays outside the overflow */
.ld-children {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.ld-children > * {
  pointer-events: auto;
}

.ld-children.ld-clip {
  overflow: hidden;
}

/* scroll-view viewport hint: a slim scrollbar track on the scrolling edge(s) */
.ld-scroll-gutter {
  position: absolute;
  pointer-events: none;
  background: rgb(255 255 255 / calc(0.14 * var(--ld-layout-opacity, 1)));
  border-radius: 2px;
}

.ld-scroll-gutter-v {
  top: 2px;
  bottom: 2px;
  right: 1px;
  width: 4px;
}

.ld-scroll-gutter-h {
  left: 2px;
  right: 2px;
  bottom: 1px;
  height: 4px;
}

/* shown while trying to drag a slot-managed child */
.ld-move-hint {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 3;
  max-width: 300px;
  min-width: 220px;
  padding: 6px 9px;
  font-size: 11.5px;
  line-height: 1.45;
  border-radius: 4px;
  background: var(--vp-c-bg-elv, #222);
  color: var(--vp-c-text-1, #eee);
  border: 1px solid var(--vp-c-divider, #555);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
  pointer-events: none;
}

.ld-repeat-badge {
  position: absolute;
  top: -18px;
  right: 0;
  font-size: 11px;
  line-height: 16px;
  padding: 0 5px;
  background: var(--vp-c-bg-soft, #333);
  color: var(--vp-c-text-2, #ccc);
  border: 1px solid var(--vp-c-divider, #555);
  white-space: nowrap;
  border-radius: 2px 2px 0 0;
  pointer-events: none;
}

/* anchor markers (cyan) — distinct from the orange selection/handles */
.ld-anchor-rect {
  position: absolute;
  border: 1px dashed rgba(125, 211, 252, 0.85);
  pointer-events: none;
  z-index: 1;
}

.ld-anchor-marker {
  position: absolute;
  width: 9px;
  height: 9px;
  background: rgba(125, 211, 252, 0.95);
  transform: translate(-50%, -50%) rotate(45deg);
  pointer-events: none;
  z-index: 2;
}


.ld-name-tag {
  position: absolute;
  top: -18px;
  left: 0;
  font-size: 11px;
  line-height: 16px;
  padding: 0 5px;
  background: var(--c-carbon-1);
  color: #fff;
  white-space: nowrap;
  border-radius: 2px 2px 0 0;
  pointer-events: none;
}

.ld-handle {
  position: absolute;
  width: 9px;
  height: 9px;
  background: #fff;
  border: 1.5px solid var(--c-carbon-1);
  border-radius: 1px;
  z-index: 2;
}

.h-nw { top: -5px; left: -5px; }
.h-n  { top: -5px; left: 50%; transform: translateX(-50%); }
.h-ne { top: -5px; right: -5px; }
.h-e  { top: 50%; right: -5px; transform: translateY(-50%); }
.h-se { bottom: -5px; right: -5px; }
.h-s  { bottom: -5px; left: 50%; transform: translateX(-50%); }
.h-sw { bottom: -5px; left: -5px; }
.h-w  { top: 50%; left: -5px; transform: translateY(-50%); }
</style>
