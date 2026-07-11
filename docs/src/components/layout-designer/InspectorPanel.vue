<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AnchorWidget from './AnchorWidget.vue'
import ColorTextFields from './ColorTextFields.vue'
import InfoTip from './InfoTip.vue'
import ItemPicker from './ItemPicker.vue'
import NumberField from './NumberField.vue'
import { hexToRgb01, rgb01ToHex, round } from './geometry'
import { TEXT_ALIGNS, TEXT_FONTS } from './types'
import { CLOSE_ROOT } from './elements/button'
import type { ContainerLayout } from './elements/container'
import type { ColorRGBA, DesignerElement, ImageFill, ListDataSource, OutlineModifier, TextAlign, TextDataSource, TextFont } from './types'
import { useDesigner } from './useDesigner'
import { collectPreviewImageIds, useLocalImages } from './useLocalImages'

const {
  selected,
  selectedIds,
  elements,
  dataSources,
  descendantIds,
  update,
  reparent,
  rectOf,
  fill,
  snapSelection,
  textEditSignal,
  removeSelected,
  duplicateSelected,
  setBinding,
  childrenOf,
  layoutOf,
  setRepeat,
  setItemBinding,
  repeatSourceOf,
  layouts,
} = useDesigner()

// Focus + select the content field when asked (e.g. context-menu "Edit label text"), after it renders.
const textArea = ref<HTMLTextAreaElement | HTMLInputElement | null>(null)
watch(textEditSignal, () =>
  nextTick(() => {
    textArea.value?.focus()
    textArea.value?.select()
  }),
)

// "Place in parent": a 3×3 grid that slams the element into a corner/edge/centre. (A padding slider
// used to live here; it read as fill+shrink rather than padding and was removed as confusing.)
const PLACE_CELLS = [
  ['left', 'top'],
  ['center', 'top'],
  ['right', 'top'],
  ['left', 'middle'],
  ['center', 'middle'],
  ['right', 'middle'],
  ['left', 'bottom'],
  ['center', 'bottom'],
  ['right', 'bottom'],
] as const
function onPlace(h: 'left' | 'center' | 'right', v: 'top' | 'middle' | 'bottom') {
  snapSelection(h, v, 0)
}

// Plain-English summary of how the selected element responds to resizing.
const anchoringText = computed(() => {
  const el = selected.value
  if (!el) return ''
  const sx = el.anchorMin.x !== el.anchorMax.x
  const sy = el.anchorMin.y !== el.anchorMax.y
  const hpos = (v: number) => (v === 0 ? 'left' : v === 0.5 ? 'center' : v === 1 ? 'right' : `${round(v)}`)
  const vpos = (v: number) => (v === 1 ? 'top' : v === 0.5 ? 'middle' : v === 0 ? 'bottom' : `${round(v)}`)
  if (sx && sy) return 'Stretches with the parent in both directions — grows and shrinks to fill it (offsets act as margins).'
  if (sx) return `Stretches with the parent's width; pinned vertically to the ${vpos(el.anchorMin.y)}.`
  if (sy) return `Stretches with the parent's height; pinned horizontally to the ${hpos(el.anchorMin.x)}.`
  const h = hpos(el.anchorMin.x)
  const v = vpos(el.anchorMin.y)
  const where = h === 'center' && v === 'middle' ? 'center' : `${v} ${h}`
  return `Fixed size; pinned to the ${where} of the parent — it won't resize when the screen does.`
})

type VecField = 'anchorMin' | 'anchorMax' | 'offsetMin' | 'offsetMax'

function setVec(el: DesignerElement, field: VecField, axis: 'x' | 'y', raw: string) {
  const value = Number.parseFloat(raw)
  if (Number.isNaN(value)) return
  update(el.id, { [field]: { ...el[field], [axis]: value } })
}

function setName(el: DesignerElement, raw: string) {
  update(el.id, { name: raw })
}

// valid re-parent targets: anything that isn't the element itself or one of its descendants
const parentOptions = computed(() => {
  const el = selected.value
  if (!el) return []
  const blocked = new Set([el.id, ...descendantIds(el.id)])
  return elements.value.filter((e) => !blocked.has(e.id))
})

function onReparent(el: DesignerElement, raw: string) {
  reparent(el.id, raw === '' ? null : raw)
}

function setHex(el: DesignerElement, hex: string) {
  const rgb = hexToRgb01(hex)
  if (!rgb) return
  update(el.id, { props: { color: { ...el.props.color, ...rgb } } })
}

function setAlpha(el: DesignerElement, raw: string) {
  const a = Number.parseFloat(raw)
  if (Number.isNaN(a)) return
  update(el.id, { props: { color: { ...el.props.color, a } } })
}

// Full-color setters for the RGBA/HEX text fields (they carry alpha, unlike the hex picker).
function setColor(el: DesignerElement, c: ColorRGBA) {
  update(el.id, { props: { color: c } })
}
function setBorderColor(el: DesignerElement, c: ColorRGBA) {
  update(el.id, { props: { border: { width: curBorder(el).width, color: c } } })
}
function setActiveColor(el: DesignerElement, c: ColorRGBA) {
  if (buttonProps.value?.activeColor) update(el.id, { props: { activeColor: c } })
}

// --- outline modifier ---
const outline = computed(() => selected.value?.modifiers?.outline ?? null)
const draggable = computed(() => selected.value?.modifiers?.draggable ?? null)
const slot = computed(() => selected.value?.modifiers?.slot ?? null)
function toggleDraggable(on: boolean) {
  const el = selected.value
  if (!el) return
  // Default to drop-anywhere so both frameworks make it freely draggable out of the box.
  update(el.id, { modifiers: { draggable: on ? { dropAnywhere: true } : null } })
}
function patchDraggable(patch: Partial<NonNullable<typeof draggable.value>>) {
  const el = selected.value
  if (!el?.modifiers?.draggable) return
  update(el.id, { modifiers: { draggable: { ...el.modifiers.draggable, ...patch } } })
}
function toggleSlot(on: boolean) {
  const el = selected.value
  if (!el) return
  update(el.id, { modifiers: { slot: on ? {} : null } })
}
function setSlotFilter(raw: string) {
  const el = selected.value
  if (!el?.modifiers?.slot) return
  update(el.id, { modifiers: { slot: { filter: raw.trim() || undefined } } })
}
function toggleOutline(on: boolean) {
  const el = selected.value
  if (!el) return
  update(el.id, { modifiers: { outline: on ? { color: { r: 0, g: 0, b: 0, a: 1 }, distance: { x: 1, y: -1 } } : null } })
}
function patchOutline(patch: Partial<OutlineModifier>) {
  const el = selected.value
  if (!el?.modifiers?.outline) return
  update(el.id, { modifiers: { outline: { ...el.modifiers.outline, ...patch } } })
}
function setOutlineHex(hex: string) {
  const rgb = hexToRgb01(hex)
  const cur = outline.value
  if (!rgb || !cur) return
  patchOutline({ color: { ...cur.color, ...rgb } })
}
function setOutlineDistance(axis: 'x' | 'y', raw: string) {
  const v = Number.parseFloat(raw)
  const cur = outline.value
  if (Number.isNaN(v) || !cur) return
  patchOutline({ distance: { ...cur.distance, [axis]: v } })
}

// Per-type prop views (null unless the selection is that type) — keep template access type-safe.
const panelProps = computed(() => (selected.value?.type === 'panel' ? selected.value.props : null))
const textProps = computed(() => (selected.value?.type === 'text' ? selected.value.props : null))
const buttonProps = computed(() => (selected.value?.type === 'button' ? selected.value.props : null))

// --- tab views ---
const tabsProps = computed(() => (selected.value?.type === 'tabs' ? selected.value.props : null))
/** Pages of the selected tab view (its direct children, in order). */
const tabPages = computed(() => (selected.value?.type === 'tabs' ? childrenOf(selected.value.id) : []))
/** Every tab view in the layout — targets for a button's "Switches tab". */
const tabViews = computed(() => elements.value.filter((e) => e.type === 'tabs'))
/** Pages of the tab view the selected BUTTON targets. */
const targetPages = computed(() => {
  const t = buttonProps.value?.tabSwitch?.target
  return t ? childrenOf(t) : []
})
function setTabSwitchTarget(el: DesignerElement, v: string) {
  update(el.id, { props: { tabSwitch: v ? { target: v, page: 0 } : null } })
}
function setTabSwitchPage(el: DesignerElement, raw: string) {
  const cur = buttonProps.value?.tabSwitch
  if (!cur) return
  update(el.id, { props: { tabSwitch: { ...cur, page: Number.parseInt(raw, 10) || 0 } } })
}
function setActiveColorEnabled(el: DesignerElement, on: boolean) {
  update(el.id, { props: { activeColor: on ? { r: 0.99, g: 0.35, b: 0.23, a: 1 } : null } })
}
function setActiveColorHex(el: DesignerElement, hex: string) {
  const cur = buttonProps.value?.activeColor
  if (!cur) return
  update(el.id, { props: { activeColor: { ...hexToRgb01(hex), a: cur.a } } })
}
function setActiveColorAlpha(el: DesignerElement, raw: string) {
  const a = Number.parseFloat(raw)
  const cur = buttonProps.value?.activeColor
  if (Number.isNaN(a) || !cur) return
  update(el.id, { props: { activeColor: { ...cur, a } } })
}
/** Candidate close targets: any element except the button itself (closing yourself is legal CUI but
 *  almost always a mistake next to '(whole menu)'). */
const closeTargets = computed(() => elements.value.filter((e) => e.id !== selected.value?.id).map((e) => ({ id: e.id, name: e.name })))
function setCloseTarget(el: DesignerElement, v: string) {
  update(el.id, { props: { close: v || undefined } })
}

// --- container layout (editor-side auto-arrange; see elements/container.ts) ---
const containerProps = computed(() => (selected.value?.type === 'container' ? selected.value.props : null))
const containerLayout = computed(() => containerProps.value?.layout ?? null)
/** The parent's layout when the selected element sits in an arranged container (its rect is managed). */
const slottedBy = computed(() => (selected.value ? layoutOf(selected.value.parentId) : null))
function toggleContainerLayout(el: DesignerElement, on: boolean) {
  if (!on) {
    update(el.id, { props: { layout: null } })
    return
  }
  // Seed the slot size from the first child's current rect so enabling doesn't visibly resize items.
  const first = childrenOf(el.id)[0]
  const r = first ? rectOf(first.id) : null
  update(el.id, {
    props: {
      layout: { direction: 'vertical', itemsPerLine: 1, itemWidth: Math.round(r?.w ?? 120), itemHeight: Math.round(r?.h ?? 32), gapX: 8, gapY: 8, padding: 0 },
    },
  })
}
function patchLayout(el: DesignerElement, patch: Partial<ContainerLayout>) {
  if (containerLayout.value) update(el.id, { props: { layout: { ...containerLayout.value, ...patch } } })
}
function setLayoutNum(el: DesignerElement, key: 'itemsPerLine' | 'itemWidth' | 'itemHeight' | 'gapX' | 'gapY' | 'padding', raw: string, min: number) {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n) || n < min) return
  patchLayout(el, { [key]: n })
}

const inputProps = computed(() => (selected.value?.type === 'input' ? selected.value.props : null))
const countdownProps = computed(() => (selected.value?.type === 'countdown' ? selected.value.props : null))
// Text-bearing props shared by text / input / countdown (all have text + fontSize + font + align), so
// the content/font/size/align controls render once for any of them.
const textLikeProps = computed(() => {
  const el = selected.value
  if (el && (el.type === 'text' || el.type === 'input' || el.type === 'countdown')) return el.props
  return null
})
/** Heading for the shared content section, per type. */
const textSectionLabel = computed(() => (selected.value?.type === 'input' ? 'Input' : selected.value?.type === 'countdown' ? 'Countdown text' : 'Text'))

// --- button / input / countdown props (generic merge setters) ---
function setCommand(el: DesignerElement, raw: string) {
  update(el.id, { props: { command: raw } })
}
function setProtected(el: DesignerElement, on: boolean) {
  update(el.id, { props: { isProtected: on } })
}
function setIntProp(el: DesignerElement, key: string, raw: string, min = 0) {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n) || n < min) return
  update(el.id, { props: { [key]: n } })
}
function setFloatProp(el: DesignerElement, key: string, raw: string, min?: number) {
  const n = Number.parseFloat(raw)
  if (Number.isNaN(n) || (min !== undefined && n < min)) return
  update(el.id, { props: { [key]: n } })
}
function setBoolProp(el: DesignerElement, key: string, on: boolean) {
  update(el.id, { props: { [key]: on } })
}

// --- fill (panel only: solid color vs URL image) ---
const fillMode = computed<'color' | 'image'>(() => (panelProps.value?.image ? 'image' : 'color'))

function setFillMode(el: DesignerElement, mode: 'color' | 'image') {
  if (el.type !== 'panel') return
  if (mode === 'image') {
    if (el.props.image) return
    // Reset the color to an opaque white tint so the image shows at its true colors.
    update(el.id, { props: { image: { kind: 'url', url: '' }, color: { r: 1, g: 1, b: 1, a: 1 } } })
  } else {
    update(el.id, { props: { image: null } })
  }
}

function setImageUrl(el: DesignerElement, raw: string) {
  update(el.id, { props: { image: { kind: 'url', url: raw.trim() } } })
}

// Image-fill kind (url / sprite / png / item icon) + per-kind field setters. The panel color is the
// image tint for every kind. Switching kind resets to that kind's default fields.
type ImageKind = ImageFill['kind']
const IMAGE_KINDS: { id: ImageKind; label: string }[] = [
  { id: 'url', label: 'URL' },
  { id: 'sprite', label: 'Sprite' },
  { id: 'png', label: 'File (id)' },
  { id: 'itemicon', label: 'Item icon' },
  { id: 'steamavatar', label: 'Steam avatar' },
  { id: 'imagedb', label: 'Image DB' },
]
const IMAGE_DEFAULTS: Record<ImageKind, ImageFill> = {
  url: { kind: 'url', url: '' },
  sprite: { kind: 'sprite', sprite: '' },
  png: { kind: 'png', png: '' },
  itemicon: { kind: 'itemicon', itemId: 0, skinId: 0 },
  steamavatar: { kind: 'steamavatar', steamId: '' },
  imagedb: { kind: 'imagedb', dbName: '', url: '' },
}
const imageKind = computed<ImageKind>(() => panelProps.value?.image?.kind ?? 'url')

function setImageKind(el: DesignerElement, kind: ImageKind) {
  if (el.type !== 'panel') return
  if (el.props.image?.kind === kind) return
  update(el.id, { props: { image: { ...IMAGE_DEFAULTS[kind] } } })
}
function setSteamId(el: DesignerElement, raw: string) {
  update(el.id, { props: { image: { kind: 'steamavatar', steamId: raw.trim() } } })
}
/** Image-DB fields keep the siblings intact (read the current image for the other values). */
function curImageDb(el: DesignerElement): { dbName: string; url: string; previewImage?: string } {
  return el.type === 'panel' && el.props.image?.kind === 'imagedb' ? el.props.image : { dbName: '', url: '' }
}
function setImageDbName(el: DesignerElement, raw: string) {
  const cur = curImageDb(el)
  update(el.id, { props: { image: { kind: 'imagedb', dbName: raw.trim(), url: cur.url, previewImage: cur.previewImage } } })
}
function setImageDbUrl(el: DesignerElement, raw: string) {
  const cur = curImageDb(el)
  update(el.id, { props: { image: { kind: 'imagedb', dbName: cur.dbName, url: raw.trim(), previewImage: cur.previewImage } } })
}
function setSprite(el: DesignerElement, raw: string) {
  update(el.id, { props: { image: { kind: 'sprite', sprite: raw.trim() } } })
}
function setPng(el: DesignerElement, raw: string) {
  const prev = el.type === 'panel' && el.props.image?.kind === 'png' ? el.props.image.previewImage : undefined
  update(el.id, { props: { image: { kind: 'png', png: raw.trim(), previewImage: prev } } })
}

// --- local preview image (png / imagedb fills) -- design-time only, lives in browser storage ---
const { putImageFile, getLocalImage, gcLocalImages } = useLocalImages()
const previewFileInput = ref<HTMLInputElement | null>(null)
const previewImage = computed(() => {
  const img = panelProps.value?.image
  return img && (img.kind === 'png' || img.kind === 'imagedb') ? getLocalImage(img.previewImage) : null
})
function patchPreviewImage(el: DesignerElement, id: string | undefined) {
  const img = el.type === 'panel' ? el.props.image : null
  if (!img || (img.kind !== 'png' && img.kind !== 'imagedb')) return
  update(el.id, { props: { image: { ...img, previewImage: id } } })
  scheduleImageGc()
}
async function onPreviewFileChange(el: DesignerElement, e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  try {
    patchPreviewImage(el, await putImageFile(f))
  } catch (err) {
    window.alert((err as Error).message)
  }
}
function clearPreviewImage(el: DesignerElement) {
  patchPreviewImage(el, undefined)
}
// GC after the debounced autosave has folded the change into the layout store, so a replaced or
// removed image that nothing references anymore is dropped from the (small) localStorage budget.
let gcTimer: ReturnType<typeof setTimeout> | null = null
function scheduleImageGc() {
  if (gcTimer) clearTimeout(gcTimer)
  gcTimer = setTimeout(() => {
    gcTimer = null
    gcLocalImages(
      collectPreviewImageIds(
        layouts.value.map((l) => l.data),
        elements.value,
      ),
    )
  }, 1200)
}
/** Item-icon fields keep the other field intact (read the current image for the sibling value). */
function curItemIcon(el: DesignerElement): { itemId: number; skinId: number } {
  return el.type === 'panel' && el.props.image?.kind === 'itemicon' ? el.props.image : { itemId: 0, skinId: 0 }
}
function setItemId(el: DesignerElement, raw: string) {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return
  update(el.id, { props: { image: { kind: 'itemicon', itemId: n, skinId: curItemIcon(el).skinId } } })
}
function setSkinId(el: DesignerElement, raw: string) {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return
  update(el.id, { props: { image: { kind: 'itemicon', itemId: curItemIcon(el).itemId, skinId: n } } })
}

// --- border (panel only: optional inset frame → four edge subpanels at codegen time) ---
const DEFAULT_BORDER = { width: 2, color: { r: 0, g: 0, b: 0, a: 1 } }
const borderProps = computed(() => panelProps.value?.border ?? null)

function setBorderEnabled(el: DesignerElement, on: boolean) {
  if (el.type !== 'panel') return
  update(el.id, { props: { border: on ? { width: DEFAULT_BORDER.width, color: { ...DEFAULT_BORDER.color } } : null } })
}
function curBorder(el: DesignerElement) {
  return el.type === 'panel' && el.props.border ? el.props.border : DEFAULT_BORDER
}
function setBorderWidth(el: DesignerElement, raw: string) {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n) || n < 0) return
  update(el.id, { props: { border: { width: n, color: { ...curBorder(el).color } } } })
}
function setBorderHex(el: DesignerElement, hex: string) {
  const rgb = hexToRgb01(hex)
  if (!rgb) return
  const b = curBorder(el)
  update(el.id, { props: { border: { width: b.width, color: { ...rgb, a: b.color.a } } } })
}
function setBorderAlpha(el: DesignerElement, raw: string) {
  const a = Number.parseFloat(raw)
  if (Number.isNaN(a)) return
  const b = curBorder(el)
  update(el.id, { props: { border: { width: b.width, color: { ...b.color, a } } } })
}

// --- text props ---
function setText(el: DesignerElement, raw: string) {
  update(el.id, { props: { text: raw } })
}
// Content is edited in a single-line field by default (Enter commits) — labels are almost always one
// line. The Multiline checkbox (text elements only) swaps in a textarea; unchecking it collapses any
// newlines to spaces so the single-line field shows exactly what will be emitted. The override is
// per-element UI state; an element whose text already wraps starts multiline.
const multilineOverride = ref<Record<string, boolean>>({})
const isMultiline = computed(() => {
  const el = selected.value
  if (!el || el.type !== 'text' || !textLikeProps.value) return false
  return multilineOverride.value[el.id] ?? textLikeProps.value.text.includes('\n')
})
function setMultiline(el: DesignerElement, on: boolean) {
  multilineOverride.value[el.id] = on
  const text = textLikeProps.value?.text ?? ''
  if (!on && text.includes('\n')) setText(el, text.replace(/\s*\n+\s*/g, ' '))
}
function setFontSize(el: DesignerElement, raw: string) {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n) || n < 1) return
  update(el.id, { props: { fontSize: n } })
}
function setAlign(el: DesignerElement, align: TextAlign) {
  update(el.id, { props: { align } })
}
function setFont(el: DesignerElement, font: TextFont) {
  update(el.id, { props: { font } })
}

// --- text binding (data sources + repeat item columns) ---
const textSources = computed(() => dataSources.value.filter((d): d is TextDataSource => d.kind === 'text'))
const listSources = computed(() => dataSources.value.filter((d): d is ListDataSource => d.kind === 'list'))
/** The list the enclosing repeating container is stamped from — non-null only inside a template. */
const repeatList = computed(() => (selected.value ? repeatSourceOf(selected.value.id) : null))
// Item-column bindings share the Source dropdowns with whole-source bindings; encoded as "item:<col>"
// so one select covers both (bindings store ids, itemBindings store column keys — never mixed).
const ITEM_PREFIX = 'item:'
/** Source-select value for the text prop: item column > text source id > '' (literal). */
const textBinding = computed(() => {
  const el = selected.value
  if (!el || el.type !== 'text') return ''
  if (el.itemBindings?.text) return ITEM_PREFIX + el.itemBindings.text
  return el.bindings?.text ?? ''
})
function setTextBinding(el: DesignerElement, v: string) {
  if (v.startsWith(ITEM_PREFIX)) {
    setBinding(el.id, 'text', null)
    setItemBinding(el.id, 'text', v.slice(ITEM_PREFIX.length))
  } else {
    setItemBinding(el.id, 'text', null)
    setBinding(el.id, 'text', v || null)
  }
}
/** Same encoding for a panel-fill prop (`image.itemId` / `image.url`) bound to an item column. */
function fillBinding(path: string): string {
  return selected.value?.itemBindings?.[path] ? ITEM_PREFIX + selected.value.itemBindings[path] : ''
}
function setFillBinding(el: DesignerElement, path: string, v: string) {
  setItemBinding(el.id, path, v.startsWith(ITEM_PREFIX) ? v.slice(ITEM_PREFIX.length) : null)
}
const itemIdColumns = computed(() => repeatList.value?.columns.filter((c) => c.kind === 'itemid') ?? [])
const urlColumns = computed(() => repeatList.value?.columns.filter((c) => c.kind === 'url') ?? [])
const textColumns = computed(() => repeatList.value?.columns.filter((c) => c.kind === 'text') ?? [])

// Heading for the shared color picker: text color, or a panel's fill color / image tint.
const colorLabel = computed(() => (textProps.value ? 'Text color' : fillMode.value === 'image' ? 'Tint' : 'Color'))

// Whether the selected element exposes a `color` prop (containers and tab views don't — rect-only).
const hasColor = computed(() => !!selected.value && selected.value.type !== 'container' && selected.value.type !== 'tabs')

const computedRect = computed(() => (selected.value ? rectOf(selected.value.id) : undefined))
</script>

<template>
  <div class="ld-inspector">
    <div v-if="selectedIds.length === 0" class="ld-empty">No element selected.<br />Click a box on the canvas.</div>

    <div v-else-if="selectedIds.length > 1" class="ld-multi">
      <div class="ld-multi-count">{{ selectedIds.length }} elements selected</div>
      <p class="ld-help-intro">Drag to move them together, or use the arrow keys to nudge. Per-element properties are hidden while multiple are selected.</p>
      <div class="ld-multi-actions">
        <button @click="duplicateSelected()">Duplicate</button>
        <button class="danger" @click="removeSelected()">Delete</button>
      </div>
    </div>

    <template v-else-if="selected">
      <label class="ld-field">
        <span class="ld-field-label">Name <InfoTip text="The CUI element name. Used to reference this element in generated code and as its parent name for children." /></span>
        <input type="text" :value="selected.name" @change="setName(selected, ($event.target as HTMLInputElement).value)" />
      </label>

      <label class="ld-field">
        <span class="ld-field-label">Parent <InfoTip text="Which element this box lives inside. Its anchors are measured against the parent's rectangle. Re-parenting keeps the box in the same on-screen spot." /></span>
        <select :value="selected.parentId ?? ''" @change="onReparent(selected, ($event.target as HTMLSelectElement).value)">
          <option value="">(root canvas)</option>
          <option v-for="opt in parentOptions" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
        </select>
      </label>

      <label v-if="selected.parentId" class="ld-passthrough">
        <input type="checkbox" :checked="!!selected.passthrough" @change="update(selected.id, { passthrough: ($event.target as HTMLInputElement).checked })" />
        <span>Move with parent <InfoTip text="Clicking or dragging this element on the canvas grabs its PARENT instead — useful for a label that fills its button. Alt-click still selects this element, and the element tree always reaches it directly." /></span>
      </label>

      <div v-if="slottedBy" class="ld-slotted">
        Slotted by the parent container's layout — position is managed (moving shows a hint), and
        resizing it on the canvas edits the container's item size for every slot. Reorder items in
        the element tree.
      </div>

      <div class="ld-behavior">
        <span class="ld-field-label">Behavior <InfoTip text="Extra CUI components on this element. Needs cursor frees the mouse so the player can click the UI; Needs keyboard captures typing (required to type into an input field). Usually set on the root panel." /></span>
        <label class="ld-passthrough">
          <input type="checkbox" :checked="!!selected.modifiers?.cursor" @change="update(selected.id, { modifiers: { cursor: ($event.target as HTMLInputElement).checked } })" />
          <span>Needs cursor <InfoTip text="Frees the mouse cursor while this UI is open so the player can point and click it. Without it the player stays in normal look/move mode and can't interact. Set it on one element per menu (usually the root panel)." /></span>
        </label>
        <label class="ld-passthrough">
          <input type="checkbox" :checked="!!selected.modifiers?.keyboard" @change="update(selected.id, { modifiers: { keyboard: ($event.target as HTMLInputElement).checked } })" />
          <span>Needs keyboard <InfoTip text="Captures keyboard focus while this UI is open — required for the player to type into an input field. Set it on the menu (usually the root panel)." /></span>
        </label>
        <label class="ld-passthrough">
          <input type="checkbox" :checked="!!outline" @change="toggleOutline(($event.target as HTMLInputElement).checked)" />
          <span>Outline <InfoTip text="Draws a colored outline (a duplicate of the graphic offset by the distance below) behind this element — the usual way to add a drop-shadow or border-glow to panels and text." /></span>
        </label>
        <div v-if="outline" class="ld-outline">
          <input class="ld-color" type="color" :value="rgb01ToHex(outline.color)" title="Outline color" @input="setOutlineHex(($event.target as HTMLInputElement).value)" />
          <label class="ld-outline-dist">X <input type="number" step="0.5" :value="outline.distance.x" @input="setOutlineDistance('x', ($event.target as HTMLInputElement).value)" /></label>
          <label class="ld-outline-dist">Y <input type="number" step="0.5" :value="outline.distance.y" @input="setOutlineDistance('y', ($event.target as HTMLInputElement).value)" /></label>
          <label class="ld-passthrough" title="Fade the outline with the graphic's alpha">
            <input type="checkbox" :checked="!!outline.useGraphicAlpha" @change="patchOutline({ useGraphicAlpha: ($event.target as HTMLInputElement).checked })" />
            <span>α</span>
          </label>
        </div>
        <ColorTextFields v-if="outline" :model-value="outline.color" @update:model-value="patchOutline({ color: $event })" />
        <label class="ld-passthrough">
          <input type="checkbox" :checked="!!draggable" @change="toggleDraggable(($event.target as HTMLInputElement).checked)" />
          <span>Draggable <InfoTip text="Lets the player pick this element up and drag it around the screen with the mouse. Pair it with a Slot (below, on another element) to build drag-and-drop UIs like inventories. Needs cursor to be on so the mouse is free." /></span>
        </label>
        <div v-if="draggable" class="ld-outline">
          <label class="ld-passthrough">
            <input type="checkbox" :checked="!!draggable.limitToParent" @change="patchDraggable({ limitToParent: ($event.target as HTMLInputElement).checked })" />
            <span>Limit to parent <InfoTip text="Confines dragging to the parent element's rectangle — the player can't drag it outside its container." /></span>
          </label>
          <label class="ld-passthrough">
            <input type="checkbox" :checked="draggable.dropAnywhere !== false" @change="patchDraggable({ dropAnywhere: ($event.target as HTMLInputElement).checked })" />
            <span>Drop anywhere <InfoTip text="On: the element stays wherever it's released. Off: it only stays if dropped onto a matching Slot (drop target), otherwise it snaps back to its start — the behavior you want for inventory-style UIs." /></span>
          </label>
          <label class="ld-outline-dist">Filter <input type="text" :value="draggable.filter ?? ''" placeholder="(any)" @input="patchDraggable({ filter: ($event.target as HTMLInputElement).value.trim() || undefined })" /></label>
          <InfoTip text="A tag matched against a Slot's filter — this element can only drop onto slots with the same tag. Leave blank to drop onto any slot." />
        </div>
        <label class="ld-passthrough">
          <input type="checkbox" :checked="!!slot" @change="toggleSlot(($event.target as HTMLInputElement).checked)" />
          <span>Slot (drop target) <InfoTip text="Makes this element a drop zone that catches Draggable elements dropped onto it — like one inventory cell. Use the Filter to control which draggables it accepts." /></span>
        </label>
        <div v-if="slot" class="ld-outline">
          <label class="ld-outline-dist">Filter <input type="text" :value="slot.filter ?? ''" placeholder="(any)" @input="setSlotFilter(($event.target as HTMLInputElement).value)" /></label>
          <InfoTip text="Only accepts draggables whose filter tag matches this text (and set the same tag on the draggable). Leave blank to accept any draggable." />
        </div>
      </div>

      <div class="ld-place">
        <span class="ld-field-label">Place in parent <InfoTip text="Slam the selection into a corner, edge or centre of its parent (keeps its size, writes its offsets)." /></span>
        <div class="ld-place-row">
          <div class="ld-place-grid">
            <button v-for="[h, v] in PLACE_CELLS" :key="`${h}-${v}`" :title="`${v} ${h}`" @click="onPlace(h, v)" />
          </div>
        </div>
      </div>

      <div class="ld-section-title">
        <span>Anchoring <small>(resize behavior)</small></span>
        <InfoTip text="Anchors decide how this box repositions and stretches when the screen size or parent changes. Setting them doesn't move the box now — it changes how it will react. Switch the Aspect buttons up top to watch it." />
      </div>
      <p class="ld-help-intro">How this box reacts when the screen / parent resizes. Set each axis, then switch the Aspect buttons up top to watch it.</p>
      <AnchorWidget />

      <p class="ld-anchoring-desc">{{ anchoringText }}</p>

      <div class="ld-fill-row">
        <span class="ld-fill-label">Fill</span>
        <button title="Stretch to fill the parent (zero offsets)" @click="fill(selected.id, 'both')">Parent</button>
        <button title="Stretch to fill the parent's width" @click="fill(selected.id, 'x')">Width</button>
        <button title="Stretch to fill the parent's height" @click="fill(selected.id, 'y')">Height</button>
      </div>

      <div class="ld-section-title">
        <span>Anchors <small>(0–1, relative to parent)</small></span>
        <InfoTip text="AnchorMin / AnchorMax are the box's bottom-left and top-right corners as a fraction of the parent (0 = left/bottom, 1 = right/top). Equal min & max on an axis = pinned point; min 0 / max 1 = stretches across that axis." />
      </div>
      <div class="ld-vec-row">
        <span class="ld-vec-label">Min</span>
        <NumberField step="0.01" :value="round(selected.anchorMin.x)" @commit="setVec(selected, 'anchorMin', 'x', $event)" />
        <NumberField step="0.01" :value="round(selected.anchorMin.y)" @commit="setVec(selected, 'anchorMin', 'y', $event)" />
      </div>
      <div class="ld-vec-row">
        <span class="ld-vec-label">Max</span>
        <NumberField step="0.01" :value="round(selected.anchorMax.x)" @commit="setVec(selected, 'anchorMax', 'x', $event)" />
        <NumberField step="0.01" :value="round(selected.anchorMax.y)" @commit="setVec(selected, 'anchorMax', 'y', $event)" />
      </div>

      <div class="ld-section-title">
        <span>Offsets <small>(px, reference space)</small></span>
        <InfoTip text="OffsetMin / OffsetMax are pixel nudges from the anchors, measured in the reference resolution. With a pinned anchor they set the box's size and position; with stretched anchors they act as margins from the parent's edges." />
      </div>
      <div class="ld-vec-row">
        <span class="ld-vec-label">Min</span>
        <NumberField step="1" :value="round(selected.offsetMin.x)" @commit="setVec(selected, 'offsetMin', 'x', $event)" />
        <NumberField step="1" :value="round(selected.offsetMin.y)" @commit="setVec(selected, 'offsetMin', 'y', $event)" />
      </div>
      <div class="ld-vec-row">
        <span class="ld-vec-label">Max</span>
        <NumberField step="1" :value="round(selected.offsetMax.x)" @commit="setVec(selected, 'offsetMax', 'x', $event)" />
        <NumberField step="1" :value="round(selected.offsetMax.y)" @commit="setVec(selected, 'offsetMax', 'y', $event)" />
      </div>

      <!-- TEXT-bearing props: text, input, and countdown all share content / font / size / align -->
      <template v-if="textLikeProps">
        <div class="ld-section-title">
          <span>{{ textSectionLabel }}</span>
          <InfoTip text="The content and how it sits in its box. Text → CuiLabel / cui.v2.CreateText; Input → CuiInputFieldComponent / cui.v2.CreateInput; Countdown → CuiTextComponent + CuiCountdownComponent / cui.v2.CreateCountdown. The font asset is shared by both frameworks." />
        </div>
        <label v-if="textProps && (textSources.length || textColumns.length)" class="ld-field">
          <span class="ld-field-label">Source <InfoTip text="What drives this label's text: a Data Source (a shared string — edit it once, every bound element updates), or — inside a repeating container's template — a column of the repeated list (each stamped item shows its own row's value). Pick (literal) to type text directly." /></span>
          <select :value="textBinding" @change="setTextBinding(selected, ($event.target as HTMLSelectElement).value)">
            <option value="">(literal text)</option>
            <optgroup v-if="textSources.length" label="Data sources">
              <option v-for="ds in textSources" :key="ds.id" :value="ds.id">{{ ds.name }}</option>
            </optgroup>
            <optgroup v-if="textColumns.length" :label="`Repeat item (${repeatList!.typeName})`">
              <option v-for="col in textColumns" :key="col.key" :value="ITEM_PREFIX + col.key">Item · {{ col.key }}</option>
            </optgroup>
          </select>
        </label>
        <label class="ld-field">
          <span class="ld-field-label">
            <template v-if="countdownProps">Format text<InfoTip text="Shown as the countdown text; the substring %TIME_LEFT% is replaced with the formatted remaining time." /></template>
            <template v-else>Content</template>
            <span v-if="textBinding" class="ld-bound-tag">bound</span>
          </span>
          <textarea
            v-if="isMultiline"
            ref="textArea"
            class="ld-textarea"
            rows="3"
            :value="textLikeProps.text"
            :disabled="!!textBinding"
            :placeholder="countdownProps ? 'e.g. %TIME_LEFT%' : textBinding ? 'Driven by the bound data source' : ''"
            @change="setText(selected, ($event.target as HTMLTextAreaElement).value)"
          />
          <input
            v-else
            ref="textArea"
            type="text"
            :value="textLikeProps.text"
            :disabled="!!textBinding"
            :placeholder="countdownProps ? 'e.g. %TIME_LEFT%' : textBinding ? 'Driven by the bound data source' : ''"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @change="setText(selected, ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label v-if="selected.type === 'text'" class="ld-passthrough">
          <input type="checkbox" :checked="isMultiline" @change="setMultiline(selected, ($event.target as HTMLInputElement).checked)" />
          <span>Multiline <InfoTip text="Edit the content as multiple lines (line breaks render in-game). Off, the field is single-line and Enter commits — what you want for almost every label; turning it off joins existing lines with spaces." /></span>
        </label>
        <label class="ld-field">
          <span class="ld-field-label">Font <InfoTip text="The Rust client font — the same asset for both frameworks. Emitted as the Font/.SetTextFont arg." /></span>
          <select :value="textLikeProps.font ?? 'RobotoCondensedRegular'" @change="setFont(selected, ($event.target as HTMLSelectElement).value as TextFont)">
            <option v-for="f in TEXT_FONTS" :key="f.id" :value="f.id">{{ f.label }}</option>
          </select>
        </label>
        <div class="ld-vec-row">
          <span class="ld-vec-label">Size</span>
          <input class="ld-range" type="range" min="4" max="64" step="1" :value="textLikeProps.fontSize" title="Font size" @input="setFontSize(selected, ($event.target as HTMLInputElement).value)" />
          <input class="ld-num" type="number" min="1" step="1" :value="textLikeProps.fontSize" title="Font size in reference px" @change="setFontSize(selected, ($event.target as HTMLInputElement).value)" />
        </div>
        <div class="ld-section-title">
          <span>Alignment <small>(in box)</small></span>
          <InfoTip text="Where the text sits within its box (Unity TextAnchor)." />
        </div>
        <div class="ld-align-grid" role="group" aria-label="Text alignment">
          <button
            v-for="a in TEXT_ALIGNS"
            :key="a"
            :class="{ active: textLikeProps.align === a }"
            :title="a"
            @click="setAlign(selected, a)"
          >
            <span class="ld-align-dot" />
          </button>
        </div>
      </template>

      <!-- CONTAINER layout — editor-side auto-arrange (writes child rects; emits no component) -->
      <template v-if="containerProps">
        <div class="ld-section-title">
          <span>Layout</span>
          <InfoTip
            text="Auto-arrange this container's children into a stack or grid. Purely an editor tool: it writes each child's anchors/offsets (top-left-anchored slots, in element-tree order) — the generated code stays plain positioned elements, no layout-group component."
          />
        </div>
        <label class="ld-passthrough">
          <input type="checkbox" :checked="!!containerLayout" @change="toggleContainerLayout(selected, ($event.target as HTMLInputElement).checked)" />
          <span>Arrange children <InfoTip text="On: children snap into slots — adding, removing or reordering re-flows them (reorder in the element tree). Items can't be moved by hand, but resizing one on the canvas edits the item size for every slot. Off: children keep their current rects and move freely again." /></span>
        </label>
        <template v-if="containerLayout">
          <label class="ld-field">
            <span class="ld-field-label">Direction <InfoTip text="Vertical stacks items top→bottom; horizontal runs them left→right. Items per line wraps the stack into a grid." /></span>
            <select :value="containerLayout.direction" @change="patchLayout(selected, { direction: ($event.target as HTMLSelectElement).value as ContainerLayout['direction'] })">
              <option value="vertical">Vertical (top→bottom)</option>
              <option value="horizontal">Horizontal (left→right)</option>
            </select>
          </label>
          <div class="ld-vec-row">
            <span class="ld-vec-label" :title="containerLayout.direction === 'vertical' ? 'Items per row (1 = single column)' : 'Items per column (1 = single row)'">
              {{ containerLayout.direction === 'vertical' ? 'Per row' : 'Per col' }}
            </span>
            <NumberField step="1" :value="containerLayout.itemsPerLine" @commit="setLayoutNum(selected, 'itemsPerLine', $event, 1)" />
          </div>
          <div class="ld-vec-row">
            <span class="ld-vec-label" title="Slot size (w × h, reference px)">Item</span>
            <NumberField step="1" :value="containerLayout.itemWidth" @commit="setLayoutNum(selected, 'itemWidth', $event, 1)" />
            <NumberField step="1" :value="containerLayout.itemHeight" @commit="setLayoutNum(selected, 'itemHeight', $event, 1)" />
          </div>
          <div class="ld-vec-row">
            <span class="ld-vec-label" title="Gap between slots (x, y px)">Gap</span>
            <NumberField step="1" :value="containerLayout.gapX" @commit="setLayoutNum(selected, 'gapX', $event, 0)" />
            <NumberField step="1" :value="containerLayout.gapY" @commit="setLayoutNum(selected, 'gapY', $event, 0)" />
          </div>
          <div class="ld-vec-row">
            <span class="ld-vec-label" title="Inset from the container's top-left corner (px)">Pad</span>
            <NumberField step="1" :value="containerLayout.padding" @commit="setLayoutNum(selected, 'padding', $event, 0)" />
          </div>
          <label class="ld-field">
            <span class="ld-field-label">Scroll <InfoTip text="Make this container a real scroll view (CuiScrollViewComponent / cui.v2.CreateScrollView): the box becomes the viewport and the slots live on a content rect sized to fit every item, scrollable along the chosen axis. Generated code sizes the content from the item count." /></span>
            <select :value="containerLayout.scroll ?? ''" @change="patchLayout(selected, { scroll: (($event.target as HTMLSelectElement).value || null) as ContainerLayout['scroll'] })">
              <option value="">(off — fixed box)</option>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label class="ld-field">
            <span class="ld-field-label">Repeat from <InfoTip text="Stamp this container's FIRST child (the item template) once per row of a list data source. The template stays fully editable and shows row 0; the remaining rows render as ghost copies in the next slots. Inside the template, bind text to the list's columns via its Source dropdown (and an item-icon's Item id via its own Source)." /></span>
            <select v-if="listSources.length" :value="selected.repeat?.source ?? ''" @change="setRepeat(selected.id, ($event.target as HTMLSelectElement).value || null)">
              <option value="">(off — static children)</option>
              <option v-for="ds in listSources" :key="ds.id" :value="ds.id">{{ ds.name }} · {{ ds.items.length }} rows</option>
            </select>
            <span v-else class="ld-help-intro">Add a List data source first (Data Sources pane → + List).</span>
          </label>
        </template>
      </template>

      <!-- INPUT extras (command + char limit + password); text/font/size/align are shared above -->
      <template v-if="inputProps">
        <div class="ld-section-title">
          <span>Input field</span>
          <InfoTip text="An editable field. On submit it runs the command with the typed value appended. Emitted as CuiInputFieldComponent (Oxide) / cui.v2.CreateInput (Carbon). The Content above is the initial text; the color above is the text color." />
        </div>
        <label class="ld-field">
          <span class="ld-field-label">Command <InfoTip text="Command run when the player submits the field; the input value is appended as an argument." /></span>
          <input type="text" placeholder="e.g. myplugin.setname" :value="inputProps.command" @change="setCommand(selected, ($event.target as HTMLInputElement).value)" />
        </label>
        <div class="ld-vec-row">
          <span class="ld-vec-label" title="Character limit (0 = unlimited)">Limit</span>
          <input class="ld-num" type="number" min="0" step="1" :value="inputProps.charLimit" title="Character limit (0 = unlimited)" @change="setIntProp(selected, 'charLimit', ($event.target as HTMLInputElement).value)" />
          <label class="ld-border-enable">
            <input type="checkbox" :checked="inputProps.password" @change="setBoolProp(selected, 'password', ($event.target as HTMLInputElement).checked)" />
            <span>Password</span>
          </label>
        </div>
        <label class="ld-border-enable">
          <input type="checkbox" :checked="inputProps.isProtected" @change="setProtected(selected, ($event.target as HTMLInputElement).checked)" />
          <span>Protected</span>
          <InfoTip text="Carbon command protection (Carbon-only; Oxide ignores it)." />
        </label>
      </template>

      <!-- COUNTDOWN extras (timer + command); text/font/size/align are shared above -->
      <template v-if="countdownProps">
        <div class="ld-section-title">
          <span>Countdown timer</span>
          <InfoTip text="Counts from Start to End seconds, client-side, substituting %TIME_LEFT% in the text. Runs the command when it reaches the end. Emitted as CuiCountdownComponent (Oxide) / cui.v2.CreateCountdown (Carbon)." />
        </div>
        <div class="ld-vec-row">
          <span class="ld-vec-label" title="Start time (seconds)">Start</span>
          <input class="ld-num" type="number" step="1" :value="countdownProps.startTime" title="Start time (seconds)" @change="setFloatProp(selected, 'startTime', ($event.target as HTMLInputElement).value)" />
          <span class="ld-vec-label" title="End time (seconds)">End</span>
          <input class="ld-num" type="number" step="1" :value="countdownProps.endTime" title="End time (seconds)" @change="setFloatProp(selected, 'endTime', ($event.target as HTMLInputElement).value)" />
        </div>
        <div class="ld-vec-row">
          <span class="ld-vec-label" title="Step (seconds per tick)">Step</span>
          <input class="ld-num" type="number" min="0" step="0.1" :value="countdownProps.step" title="Step — seconds decremented per tick" @change="setFloatProp(selected, 'step', ($event.target as HTMLInputElement).value, 0)" />
          <span class="ld-vec-label" title="Client refresh interval (Carbon)">Int.</span>
          <input class="ld-num" type="number" min="0" step="0.1" :value="countdownProps.interval" title="Client refresh interval in seconds (Carbon only)" @change="setFloatProp(selected, 'interval', ($event.target as HTMLInputElement).value, 0)" />
        </div>
        <label class="ld-field">
          <span class="ld-field-label">Command <InfoTip text="Optional command run when the countdown reaches the end. Leave empty for none." /></span>
          <input type="text" placeholder="(none)" :value="countdownProps.command" @change="setCommand(selected, ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="ld-border-enable">
          <input type="checkbox" :checked="countdownProps.isProtected" @change="setProtected(selected, ($event.target as HTMLInputElement).checked)" />
          <span>Protected</span>
          <InfoTip text="Carbon command protection (Carbon-only; Oxide ignores it)." />
        </label>
      </template>

      <!-- BUTTON props (command + Carbon command protection); the label is a child Text element -->
      <template v-if="buttonProps">
        <div class="ld-section-title">
          <span>Button</span>
          <InfoTip text="The command run on click. Emitted as CuiButton.Button.Command (Oxide) / cui.v2.CreateButton (Carbon). The button's label is a child Text element — select it in the tree to edit the wording, font, or bind it to a data source." />
        </div>
        <label class="ld-field">
          <span class="ld-field-label">Command <InfoTip text="Console/chat command sent when the button is clicked. Leave empty for a non-interactive colored box." /></span>
          <input type="text" placeholder="e.g. myplugin.action" :value="buttonProps.command" @change="setCommand(selected, ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="ld-border-enable">
          <input type="checkbox" :checked="buttonProps.isProtected" @change="setProtected(selected, ($event.target as HTMLInputElement).checked)" />
          <span>Protected</span>
          <InfoTip text="Carbon command protection (Carbon-only; Oxide ignores it). Wraps the command so it can't be triggered by spoofed client input. Maps to the isProtected arg of cui.v2.CreateButton." />
        </label>
        <label class="ld-field">
          <span class="ld-field-label">Close on click <InfoTip text="Destroys the chosen element CLIENT-SIDE when clicked - no command or server round-trip (CuiButton.Close / .SetButtonClose). '(whole menu)' closes the transparent root the generated code wraps everything in - the standard close button." /></span>
          <select :value="buttonProps.close ?? ''" @change="setCloseTarget(selected, ($event.target as HTMLSelectElement).value)">
            <option value="">(nothing)</option>
            <option :value="CLOSE_ROOT">(whole menu)</option>
            <option v-for="opt in closeTargets" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
          </select>
        </label>
        <label v-if="tabViews.length" class="ld-field">
          <span class="ld-field-label">Switches tab <InfoTip text="Clicking shows a page of the chosen Tab view: the generated handler clears the tab container and rewrites it with that page. Overrides Command. Double-click this button on the canvas to preview its page." /></span>
          <select :value="buttonProps.tabSwitch?.target ?? ''" @change="setTabSwitchTarget(selected, ($event.target as HTMLSelectElement).value)">
            <option value="">(off)</option>
            <option v-for="tv in tabViews" :key="tv.id" :value="tv.id">{{ tv.name }}</option>
          </select>
        </label>
        <label v-if="buttonProps.tabSwitch" class="ld-field">
          <span class="ld-field-label">Page</span>
          <select :value="String(buttonProps.tabSwitch.page)" @change="setTabSwitchPage(selected, ($event.target as HTMLSelectElement).value)">
            <option v-for="(pg, i) in targetPages" :key="pg.id" :value="String(i)">{{ i + 1 }} - {{ pg.name }}</option>
          </select>
        </label>
        <template v-if="buttonProps.tabSwitch">
          <label class="ld-passthrough">
            <input type="checkbox" :checked="!!buttonProps.activeColor" @change="setActiveColorEnabled(selected, ($event.target as HTMLInputElement).checked)" />
            <span>Active color <InfoTip text="Color while this button's page is the active one. Set alpha to 0 to make the button invisible when selected." /></span>
          </label>
          <div v-if="buttonProps.activeColor" class="ld-vec-row">
            <input class="ld-color" type="color" :value="rgb01ToHex(buttonProps.activeColor)" title="Active color" @input="setActiveColorHex(selected, ($event.target as HTMLInputElement).value)" />
            <span class="ld-vec-label">a</span>
            <input class="ld-num" type="number" min="0" max="1" step="0.05" :value="buttonProps.activeColor.a" title="Active alpha (0 = invisible when selected)" @change="setActiveColorAlpha(selected, ($event.target as HTMLInputElement).value)" />
          </div>
          <ColorTextFields v-if="buttonProps.activeColor" :model-value="buttonProps.activeColor" @update:model-value="setActiveColor(selected, $event)" />
        </template>
      </template>

      <!-- TAB VIEW: pages are the children; switch buttons are ordinary buttons anywhere -->
      <template v-if="tabsProps">
        <div class="ld-section-title">
          <span>Tab view</span>
          <InfoTip
            text="A swappable container: each CHILD is a page, and only the active page exists on the client. Any button anywhere can switch pages ('Switches tab' on the button) - style or scatter them freely. Generated code clears and rewrites this container when a tab button is clicked."
          />
        </div>
        <label class="ld-field">
          <span class="ld-field-label">Switch command <InfoTip text="Console command the tab buttons run with the page index appended; the generated plugin's handler re-renders with that page." /></span>
          <input type="text" :value="tabsProps.command" @change="update(selected.id, { props: { command: ($event.target as HTMLInputElement).value } })" />
        </label>
        <label class="ld-field">
          <span class="ld-field-label">Active page <InfoTip text="Which page renders on the canvas and in previews. Generated code always opens on page 1." /></span>
          <select :value="String(tabsProps.activeTab)" @change="update(selected.id, { props: { activeTab: Number.parseInt(($event.target as HTMLSelectElement).value, 10) || 0 } })">
            <option v-for="(pg, i) in tabPages" :key="pg.id" :value="String(i)">{{ i + 1 }} - {{ pg.name }}</option>
          </select>
        </label>
        <p class="ld-help-intro">Add a page: add a child element (containers work best). Rename the child to rename the page.</p>
      </template>

      <!-- PANEL fill (solid color vs image — url / sprite / file / item icon) -->
      <template v-if="panelProps">
        <div class="ld-section-title">
          <span>Fill</span>
          <InfoTip text="What this panel renders: a solid color, or an image. Image kinds map to the framework's creators — URL (CuiRawImageComponent / CreateUrlImage), Sprite (Image.Sprite / CreateSprite), File by data id (Image.Png / CreateImage), Item icon (Image.ItemId / CreateItemIcon). The panel color is the image tint." />
        </div>
        <div class="ld-segmented ld-fill-toggle" role="group" aria-label="Fill type">
          <button :class="{ active: fillMode === 'color' }" @click="setFillMode(selected, 'color')">Color</button>
          <button :class="{ active: fillMode === 'image' }" @click="setFillMode(selected, 'image')">Image</button>
        </div>
        <template v-if="fillMode === 'image'">
          <label class="ld-field">
            <span class="ld-field-label">Image source <InfoTip text="Where the image comes from. URL downloads at runtime; Sprite is a Rust client asset path; File is a stored image's SQL data id; Item icon renders an item's inventory icon by item id (+ optional skin id)." /></span>
            <select :value="imageKind" @change="setImageKind(selected, ($event.target as HTMLSelectElement).value as 'url')">
              <option v-for="k in IMAGE_KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
            </select>
          </label>
          <template v-if="imageKind === 'url'">
            <label class="ld-field">
              <span class="ld-field-label">Image URL <InfoTip text="The raw image URL. Emitted as CuiRawImageComponent.Url (Oxide) / the url arg of cui.v2.CreateUrlImage (Carbon)." /></span>
              <input type="text" placeholder="https://example.com/image.png" :value="panelProps.image?.kind === 'url' ? panelProps.image.url : ''" @change="setImageUrl(selected, ($event.target as HTMLInputElement).value)" />
            </label>
            <label v-if="urlColumns.length" class="ld-field">
              <span class="ld-field-label">Source <InfoTip text="Bind the URL to a column of the repeated list — each stamped item shows its own row's image. Pick (literal) to type a URL directly." /></span>
              <select :value="fillBinding('image.url')" @change="setFillBinding(selected, 'image.url', ($event.target as HTMLSelectElement).value)">
                <option value="">(literal URL)</option>
                <option v-for="col in urlColumns" :key="col.key" :value="ITEM_PREFIX + col.key">Item · {{ col.key }}</option>
              </select>
            </label>
          </template>
          <label v-else-if="imageKind === 'sprite'" class="ld-field">
            <span class="ld-field-label">Sprite path <InfoTip text="A Rust client sprite asset path, e.g. assets/content/ui/ui.background.tile.psd. Emitted as CuiImageComponent.Sprite (Oxide) / cui.v2.CreateSprite (Carbon). Use a real in-game asset path — an invalid one can crash the CUI on the client." /></span>
            <input type="text" placeholder="assets/content/ui/ui.background.tile.psd" :value="panelProps.image?.kind === 'sprite' ? panelProps.image.sprite : ''" @change="setSprite(selected, ($event.target as HTMLInputElement).value)" />
          </label>
          <label v-else-if="imageKind === 'png'" class="ld-field">
            <span class="ld-field-label">File data id <InfoTip text="The SQL data id of a stored image (e.g. from ImageLibrary / FileStorage). Emitted as CuiImageComponent.Png (Oxide) / cui.v2.CreateImage (Carbon). The image must be loaded server-side first." /></span>
            <input type="text" placeholder="e.g. 123456789" :value="panelProps.image?.kind === 'png' ? panelProps.image.png : ''" @change="setPng(selected, ($event.target as HTMLInputElement).value)" />
          </label>
          <template v-else-if="imageKind === 'itemicon'">
            <div class="ld-vec-row">
              <span class="ld-vec-label" title="Item id">Item</span>
              <ItemPicker :model-value="panelProps.image?.kind === 'itemicon' ? panelProps.image.itemId : 0" @update:model-value="setItemId(selected, String($event))" />
            </div>
            <div class="ld-vec-row">
              <span class="ld-vec-label" title="Skin id">Skin</span>
              <input class="ld-num" type="number" step="1" :value="panelProps.image?.kind === 'itemicon' ? panelProps.image.skinId : 0" title="Skin id (0 = default skin). The canvas preview always shows the default icon." @change="setSkinId(selected, ($event.target as HTMLInputElement).value)" />
            </div>
            <label v-if="itemIdColumns.length" class="ld-field">
              <span class="ld-field-label">Source <InfoTip text="Bind the Item id to a column of the repeated list — each stamped item shows its own row's icon. Pick (literal) to type an id directly." /></span>
              <select :value="fillBinding('image.itemId')" @change="setFillBinding(selected, 'image.itemId', ($event.target as HTMLSelectElement).value)">
                <option value="">(literal id)</option>
                <option v-for="col in itemIdColumns" :key="col.key" :value="ITEM_PREFIX + col.key">Item · {{ col.key }}</option>
              </select>
            </label>
            <p class="ld-help-intro">Item icon by id. Emitted as CuiImageComponent.ItemId/SkinId (Oxide) / cui.v2.CreateItemIcon (Carbon, no tint).</p>
          </template>
          <label v-else-if="imageKind === 'steamavatar'" class="ld-field">
            <span class="ld-field-label">SteamID64 <InfoTip text="A player's SteamID64. Renders their Steam avatar — CuiRawImageComponent.SteamId (Oxide) / cui.v2.CreateSteamAvatar (Carbon). No preload needed; the client fetches it." /></span>
            <input type="text" inputmode="numeric" placeholder="76561198000000000" :value="panelProps.image?.kind === 'steamavatar' ? panelProps.image.steamId : ''" @change="setSteamId(selected, ($event.target as HTMLInputElement).value)" />
          </label>
          <template v-else-if="imageKind === 'imagedb'">
            <label class="ld-field">
              <span class="ld-field-label">Image name <InfoTip text="A name you assign the image in the framework's image database. Emitted as cui.v2.CreateImageFromDb (Carbon) / an ImageLibrary GetImage reference (Oxide). The plugin lifecycle preloads it from the URL below." /></span>
              <input type="text" placeholder="e.g. my_logo" :value="panelProps.image?.kind === 'imagedb' ? panelProps.image.dbName : ''" @change="setImageDbName(selected, ($event.target as HTMLInputElement).value)" />
            </label>
            <label class="ld-field">
              <span class="ld-field-label">Preload URL <InfoTip text="Where the image is downloaded from at plugin load. The generated Class output queues it into the image DB under the name above; the designer preview renders straight from this URL." /></span>
              <input type="text" placeholder="https://example.com/logo.png" :value="panelProps.image?.kind === 'imagedb' ? panelProps.image.url : ''" @change="setImageDbUrl(selected, ($event.target as HTMLInputElement).value)" />
            </label>
          </template>
          <div v-if="imageKind === 'png' || imageKind === 'imagedb'" class="ld-field">
            <span class="ld-field-label">Preview image <InfoTip text="A local image file shown on the canvas while designing. It stays in this browser's storage -- never uploaded anywhere and never part of the generated code; in game the fill renders from the source above. The Code pane's Download button bundles attached images next to the .cs in their original format." /></span>
            <div class="ld-previmg-row">
              <img v-if="previewImage" class="ld-previmg-thumb" :src="previewImage.dataUrl" alt="" :title="previewImage.name" />
              <button class="ld-previmg-btn" type="button" @click="previewFileInput?.click()">{{ previewImage ? 'Replace...' : 'Browse...' }}</button>
              <button v-if="previewImage" class="ld-previmg-btn" type="button" @click="clearPreviewImage(selected)">Remove</button>
              <input ref="previewFileInput" type="file" accept="image/*" class="ld-previmg-file" @change="onPreviewFileChange(selected, $event)" />
            </div>
          </div>
        </template>
      </template>

      <template v-if="hasColor">
        <div class="ld-section-title">
          <span>{{ colorLabel }}</span>
          <InfoTip :text="textProps ? 'The text (font) color and opacity (α). Maps to CuiTextComponent.Color / the color arg of cui.v2.CreateText.' : fillMode === 'image' ? 'Color multiplied over the image (white = original colors, lower α = more transparent). Maps to the image Color arg / CuiRawImageComponent.Color.' : 'Panel background color and opacity (α). Stored as CUI 0–1 channels — see the \'r g b a\' string in the Captured values panel.'" />
        </div>
        <div class="ld-vec-row">
          <input class="ld-color" type="color" :value="rgb01ToHex(selected.props.color)" :title="colorLabel" @input="setHex(selected, ($event.target as HTMLInputElement).value)" />
          <span class="ld-vec-label ld-alpha-label" title="Opacity (alpha), 0–1">α</span>
          <input class="ld-range" type="range" min="0" max="1" step="0.01" :value="selected.props.color.a" title="Opacity (alpha)" @input="setAlpha(selected, ($event.target as HTMLInputElement).value)" />
          <input class="ld-num" type="number" min="0" max="1" step="0.05" :value="round(selected.props.color.a)" @change="setAlpha(selected, ($event.target as HTMLInputElement).value)" />
        </div>
        <ColorTextFields :model-value="selected.props.color" @update:model-value="setColor(selected, $event)" />
      </template>

      <!-- PANEL border (optional inset frame → four edge subpanels) -->
      <template v-if="panelProps">
        <div class="ld-section-title">
          <label class="ld-border-enable">
            <input type="checkbox" :checked="!!borderProps" @change="setBorderEnabled(selected, ($event.target as HTMLInputElement).checked)" />
            <span>Border</span>
          </label>
          <InfoTip text="Optional inset border. CUI has no border primitive, so it's emitted as four edge subpanels (top/bottom/left/right) inside the panel — width in reference px. Toggling it sends/removes those panels in the live preview." />
        </div>
        <div v-if="borderProps" class="ld-vec-row">
          <input class="ld-color" type="color" :value="rgb01ToHex(borderProps.color)" title="Border color" @input="setBorderHex(selected, ($event.target as HTMLInputElement).value)" />
          <span class="ld-vec-label" title="Border width (reference px)">w</span>
          <input class="ld-num" type="number" min="0" step="1" :value="borderProps.width" title="Border width (px)" @change="setBorderWidth(selected, ($event.target as HTMLInputElement).value)" />
          <span class="ld-vec-label ld-alpha-label" title="Opacity (alpha), 0–1">α</span>
          <input class="ld-num" type="number" min="0" max="1" step="0.05" :value="round(borderProps.color.a)" title="Border opacity" @change="setBorderAlpha(selected, ($event.target as HTMLInputElement).value)" />
        </div>
        <ColorTextFields v-if="borderProps" :model-value="borderProps.color" @update:model-value="setBorderColor(selected, $event)" />
      </template>

      <div v-if="computedRect" class="ld-resolved">
        <span>
          Resolved (CUI px): x {{ round(computedRect.x, 1) }}, y {{ round(computedRect.y, 1) }},
          w {{ round(computedRect.w, 1) }}, h {{ round(computedRect.h, 1) }}
        </span>
        <InfoTip text="The box's final rectangle after anchors + offsets are applied, in reference pixels. x,y is the bottom-left corner and y is measured upward (CUI convention)." />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ld-inspector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.ld-empty {
  color: var(--vp-c-text-3);
  font-size: 13px;
  text-align: center;
  padding: 24px 8px;
  line-height: 1.6;
}

.ld-multi {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ld-multi-count {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.ld-multi-actions {
  display: flex;
  gap: 8px;
}

.ld-multi-actions button {
  flex: 1;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
}

.ld-multi-actions button:hover {
  border-color: var(--c-carbon-1);
}

.ld-border-enable {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.ld-border-enable input {
  cursor: pointer;
}

.ld-passthrough {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 0 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  cursor: pointer;
}
.ld-passthrough input {
  cursor: pointer;
  flex-shrink: 0;
}

.ld-behavior {
  margin: 2px 0 10px;
}
.ld-behavior .ld-passthrough {
  margin: 4px 0 0;
}
.ld-outline {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0 20px;
}
.ld-outline .ld-outline-dist {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.ld-outline .ld-outline-dist input {
  width: 44px;
}
.ld-outline .ld-passthrough {
  margin: 0;
}

.ld-place {
  margin: 2px 0 10px;
}
.ld-place-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 6px;
}
.ld-place-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  width: 66px;
  height: 66px;
  padding: 3px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  flex-shrink: 0;
}
.ld-place-grid button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  background: var(--vp-c-bg-soft);
}
.ld-place-grid button:hover {
  border-color: var(--c-carbon-1);
  background: var(--c-carbon-soft);
}
.ld-multi-actions button.danger:hover {
  border-color: var(--vp-c-danger-1);
  color: var(--vp-c-danger-1);
}

.ld-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.ld-field input,
.ld-field select {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  padding: 4px 6px;
  color: var(--vp-c-text-1);
  font-size: 13px;
}

/* A bound text prop is read-only — its value comes from the data source. */
.ld-field textarea:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

/* banner on children whose rect is managed by the parent container's layout */
.ld-slotted {
  margin: 6px 0;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px dashed var(--vp-c-divider);
}

.ld-bound-tag {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.ld-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-top: 6px;
}

.ld-section-title small {
  font-weight: 400;
  color: var(--vp-c-text-3);
}

.ld-field-label {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ld-help-intro {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--vp-c-text-3);
}

.ld-anchoring-desc {
  margin: 0;
  padding: 7px 9px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-1);
  background: rgba(125, 211, 252, 0.08);
  border-left: 2px solid rgba(125, 211, 252, 0.7);
  border-radius: 2px;
}

.ld-fill-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ld-fill-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--vp-c-text-3);
}

.ld-fill-row button {
  flex: 1;
  padding: 5px 4px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
}

.ld-fill-row button:hover {
  border-color: var(--c-carbon-1);
  color: var(--vp-c-text-1);
}

.ld-vec-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ld-vec-label {
  width: 28px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.ld-vec-row input[type='number'] {
  width: 100%;
  min-width: 0;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  padding: 4px 6px;
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.ld-fill-toggle {
  display: flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  overflow: hidden;
}

.ld-fill-toggle button {
  flex: 1;
  padding: 5px 4px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border-right: 1px solid var(--vp-c-divider);
}

.ld-fill-toggle button:last-child {
  border-right: none;
}

.ld-fill-toggle button:hover {
  color: var(--vp-c-text-1);
}

.ld-fill-toggle button.active {
  background: var(--c-carbon-1);
  color: #fff;
}

.ld-textarea {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  padding: 4px 6px;
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}

/* 3×3 alignment picker — grid position maps to the TextAnchor (top-left = UpperLeft, …) */
.ld-align-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  width: 90px;
}

.ld-align-grid button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
}

.ld-align-grid button:hover {
  border-color: var(--c-carbon-1);
}

.ld-align-grid button.active {
  background: var(--c-carbon-1);
  border-color: var(--c-carbon-1);
}

.ld-align-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
}

.ld-align-grid button.active .ld-align-dot {
  background: #fff;
}

.ld-color {
  width: 44px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  background: none;
}

.ld-alpha-label {
  width: auto;
  flex-shrink: 0;
}

/* slider + numeric entry pair (font size, alpha) */
.ld-vec-row input.ld-range {
  flex: 1;
  min-width: 36px;
  width: auto;
  margin: 0;
  accent-color: var(--c-carbon-1);
  cursor: pointer;
}

.ld-vec-row input.ld-num {
  flex: 0 0 auto;
  width: 52px;
}

.ld-resolved {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}

/* local preview image row (png / image-db fills) */
.ld-previmg-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ld-previmg-thumb {
  width: 30px;
  height: 30px;
  object-fit: contain;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: #0c0c0e;
}

.ld-previmg-btn {
  padding: 3px 9px;
  font-size: 11.5px;
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
}

.ld-previmg-btn:hover {
  border-color: var(--c-carbon-1);
  color: var(--vp-c-text-1);
}

.ld-previmg-file {
  display: none;
}
</style>
