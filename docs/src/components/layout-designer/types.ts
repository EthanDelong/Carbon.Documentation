// Data model for the Layout Designer.
//
// All positional values are stored in CUI-native convention so they map 1:1 to the
// values that will eventually be emitted as code:
//   - anchors  (anchorMin / anchorMax): 0..1, relative to the parent's rect
//   - offsets  (offsetMin / offsetMax): pixels, in the canvas reference space
//   - Y axis is BOTTOM-UP (origin bottom-left), exactly like Unity RectTransform / CUI
// The DOM (top-down) conversion happens only at render time in geometry.ts.

// Element types whose Props/Element interfaces live beside their behavior (elements/<type>.ts) are
// imported here purely to assemble the DesignerElement union below. Type-only — no runtime coupling.
import type { ButtonElement } from './elements/button'
import type { ContainerElement } from './elements/container'
import type { TabsElement } from './elements/tabs'
import type { CountdownElement } from './elements/countdown'
import type { InputElement } from './elements/input'

export interface Vec2 {
  x: number
  y: number
}

/** Color channels in 0..1 (CUI format). */
export interface ColorRGBA {
  r: number
  g: number
  b: number
  a: number
}

export type ElementType = 'panel' | 'text' | 'container' | 'button' | 'input' | 'countdown' | 'tabs'
// The addable-type list (label + order) is derived from the element registry — see
// elements/registry.ts (`ELEMENT_TYPES`). This file owns only the discriminated-union data model.
//
// Convention: an element type's Props/Element interface and behavior live in its own module under
// elements/ (e.g. elements/container.ts). This file imports the Element type and adds it to the
// DesignerElement union + the ElementType string below.

/** Target framework for code generation. */
export type Provider = 'oxide' | 'carbon' | 'both'

/** Rust client UI layer that the root of the layout attaches to. */
export type ClientPanel =
  | 'Overall'
  | 'Overlay'
  | 'OverlayNonScaled'
  | 'HudMenu'
  | 'Hud'
  | 'Under'
  | 'UnderNonScaled'
  | 'Inventory'
  | 'Crafting'
  | 'Contacts'
  | 'Clans'
  | 'TechTree'
  | 'Map'

export interface ClientPanelDef {
  id: ClientPanel
  label: string
  /** Oxide CUI parent string — root elements parent to this directly. */
  oxide: string
  /** Carbon `CUI.ClientPanels` enum member — used via `cui.v2.CreateParent(...)`. */
  carbon: string
}

/** Selectable root layers. `oxide` is the literal CUI parent string; `carbon` the enum member. */
export const CLIENT_PANELS: ClientPanelDef[] = [
  { id: 'Overlay', label: 'Overlay', oxide: 'Overlay', carbon: 'Overlay' },
  { id: 'OverlayNonScaled', label: 'Overlay (non-scaled)', oxide: 'OverlayNonScaled', carbon: 'OverlayNonScaled' },
  { id: 'Overall', label: 'Overall', oxide: 'Overall', carbon: 'Overall' },
  { id: 'HudMenu', label: 'Hud.Menu', oxide: 'Hud.Menu', carbon: 'HudMenu' },
  { id: 'Hud', label: 'Hud', oxide: 'Hud', carbon: 'Hud' },
  { id: 'Under', label: 'Under', oxide: 'Under', carbon: 'Under' },
  { id: 'UnderNonScaled', label: 'Under (non-scaled)', oxide: 'UnderNonScaled', carbon: 'UnderNonScaled' },
  { id: 'Inventory', label: 'Inventory', oxide: 'Inventory', carbon: 'Inventory' },
  { id: 'Crafting', label: 'Crafting', oxide: 'Crafting', carbon: 'Crafting' },
  { id: 'Contacts', label: 'Contacts', oxide: 'Contacts', carbon: 'Contacts' },
  { id: 'Clans', label: 'Clans', oxide: 'Clans', carbon: 'Clans' },
  { id: 'TechTree', label: 'TechTree', oxide: 'TechTree', carbon: 'TechTree' },
  { id: 'Map', label: 'Map', oxide: 'Map', carbon: 'Map' },
]

/**
 * Image fill layered over a panel's background (the panel's `color` doubles as the image tint).
 * Discriminated on `kind`, mirroring the framework's image creators:
 *  - `url`      raw/remote image — `CuiRawImageComponent` / `cui.v2.CreateUrlImage`
 *  - `sprite`   a Rust client sprite asset — `CuiImageComponent.Sprite` / `cui.v2.CreateSprite`
 *  - `png`      a stored file by SQL data id — `CuiImageComponent.Png` / `cui.v2.CreateImage`
 *  - `itemicon` an item's inventory icon — `CuiImageComponent.ItemId/SkinId` / `cui.v2.CreateItemIcon`
 *  - `steamavatar` a player's Steam avatar — `CuiRawImageComponent.SteamId` / `cui.v2.CreateSteamAvatar`
 *  - `imagedb`  a preloaded stored image by name — ImageLibrary png (Oxide) / `cui.v2.CreateImageFromDb`
 */
export type ImageFill =
  | { kind: 'url'; url: string }
  | { kind: 'sprite'; sprite: string }
  // `previewImage` (png / imagedb): id of a locally-browsed image in the designer's browser-storage
  // image store (useLocalImages) -- canvas preview only. It is NEVER emitted into generated code or
  // AddUi JSON (the in-game source stays the data id / db name), and a dangling id (layout imported
  // on another machine) just means no preview.
  | { kind: 'png'; png: string; previewImage?: string }
  | { kind: 'itemicon'; itemId: number; skinId: number }
  // SteamID64 exceeds JS's safe integer range, so keep it a string to preserve precision.
  | { kind: 'steamavatar'; steamId: string }
  // A named image loaded into the framework's image DB from `url` (preloaded in the plugin lifecycle).
  | { kind: 'imagedb'; dbName: string; url: string; previewImage?: string }

/**
 * Optional border. CUI has no border primitive, so codegen renders it as four edge subpanels
 * (top/bottom/left/right) nested in the panel — NOT a single wrapper behind it, which would bleed
 * through a translucent panel. Absent/null or width<=0 => no border.
 */
export interface PanelBorder {
  /** Border thickness in reference px. */
  width: number
  color: ColorRGBA
}

export interface PanelProps {
  /** Panel background color — or, when an image fill is set, the image's tint. */
  color: ColorRGBA
  /** Optional image fill. Absent/null => plain solid-color panel (unchanged legacy behavior). */
  image?: ImageFill | null
  /** Optional inset border, rendered as four edge subpanels at codegen time. */
  border?: PanelBorder | null
}

/** Unity `TextAnchor` members — the alignment of text within its box (vertical × horizontal). */
export type TextAlign =
  | 'UpperLeft'
  | 'UpperCenter'
  | 'UpperRight'
  | 'MiddleLeft'
  | 'MiddleCenter'
  | 'MiddleRight'
  | 'LowerLeft'
  | 'LowerCenter'
  | 'LowerRight'

/** Row-major (top→bottom, left→right) — drives the inspector's 3×3 alignment grid. */
export const TEXT_ALIGNS: TextAlign[] = [
  'UpperLeft',
  'UpperCenter',
  'UpperRight',
  'MiddleLeft',
  'MiddleCenter',
  'MiddleRight',
  'LowerLeft',
  'LowerCenter',
  'LowerRight',
]

/**
 * Font choice. Client-centric: the same Rust font asset is used by BOTH frameworks — Oxide sets
 * `CuiTextComponent.Font = "<file>"` and Carbon chains `.SetTextFont(CUI.Handler.FontTypes.<id>)`,
 * which resolve to the identical file. So there is no Oxide-vs-Carbon font split. `id` is the Carbon
 * `FontTypes` member; `oxide` is the matching filename; `css`/`weight` are a preview-only approximation.
 */
export type TextFont =
  | 'RobotoCondensedRegular'
  | 'RobotoCondensedBold'
  | 'PermanentMarker'
  | 'DroidSansMono'
  | 'PressStart'
  | 'Poxel'

export interface FontDef {
  id: TextFont
  label: string
  oxide: string
  css: string
  weight?: number
}

export const DEFAULT_TEXT_FONT: TextFont = 'RobotoCondensedRegular'

export const TEXT_FONTS: FontDef[] = [
  { id: 'RobotoCondensedRegular', label: 'Roboto Condensed', oxide: 'robotocondensed-regular.ttf', css: "'Roboto Condensed', system-ui, sans-serif" },
  { id: 'RobotoCondensedBold', label: 'Roboto Condensed Bold', oxide: 'robotocondensed-bold.ttf', css: "'Roboto Condensed', system-ui, sans-serif", weight: 700 },
  { id: 'PermanentMarker', label: 'Permanent Marker', oxide: 'permanentmarker.ttf', css: "'Permanent Marker', 'Comic Sans MS', cursive" },
  { id: 'DroidSansMono', label: 'Droid Sans Mono', oxide: 'droidsansmono.ttf', css: "'Droid Sans Mono', ui-monospace, monospace" },
  { id: 'PressStart', label: 'Press Start 2P', oxide: 'pressstart2p-regular.ttf', css: "'Press Start 2P', ui-monospace, monospace" },
  { id: 'Poxel', label: 'Poxel', oxide: 'poxel.otf', css: "'Poxel', system-ui, sans-serif" },
]

/** Resolve a (possibly missing, for legacy layouts) font id to its definition; falls back to default. */
export function fontDef(id: TextFont | undefined | null): FontDef {
  return TEXT_FONTS.find((f) => f.id === id) ?? TEXT_FONTS[0]
}

export interface TextProps {
  /** Text (font) color, CUI channels 0..1. */
  color: ColorRGBA
  text: string
  /** Font size in reference px (CuiTextComponent.FontSize / LUI fontSize). */
  fontSize: number
  align: TextAlign
  /** Font asset (shared by both frameworks). Optional for legacy layouts → resolves to the default. */
  font?: TextFont
}

/** Fields shared by every element regardless of type. Extended by each element module's type. */
export interface BaseElement {
  id: string
  name: string
  /** null => positioned against the root canvas. */
  parentId: string | null
  anchorMin: Vec2
  anchorMax: Vec2
  offsetMin: Vec2
  offsetMax: Vec2
  /**
   * Optional prop bindings: maps an element prop path (e.g. `"text"`) to a {@link DataSource} id. A
   * bound prop draws its value from that data source instead of its literal. In the *Class* output
   * the source becomes a field the element references; every other path (UX / JSON / Selected / live
   * preview) inlines the resolved value. Absent => every prop is a literal (legacy behaviour).
   */
  bindings?: Record<string, string>
  /**
   * Set on a LAYOUT CONTAINER: repeat its first-child subtree (the item template) once per row of the
   * referenced list data source, into the container's layout slots. The template stays a normal
   * editable subtree showing row 0; rows 1..N render as non-interactive ghosts on the canvas and as
   * concrete elements in codegen/preview (expandRepeats). Absent/null => a normal container.
   */
  repeat?: { source: string } | null
  /**
   * Bindings into the CURRENT REPEAT ITEM (only meaningful inside a repeating container's template):
   * maps an element prop path (e.g. `"text"`, `"image.itemId"`) to a column key of the repeated list
   * source. Kept separate from {@link bindings} (which reference whole data sources by id) so each
   * map stays a plain string→string record. Absent => no item bindings.
   */
  itemBindings?: Record<string, string>
  /**
   * Editor-only grouping tag (NOT a CUI node): elements sharing a `groupId` are one group — clicking any
   * member selects them all and they move together. Ignored by codegen; the element tree keeps the real
   * parent hierarchy. Absent => ungrouped.
   */
  groupId?: string
  /**
   * Editor-only: when set, canvas clicks/drags pass through to the PARENT (you grab the parent, not this
   * element) — e.g. a label filling its button. Alt-click still reaches this element; codegen ignores it.
   */
  passthrough?: boolean
  /**
   * Optional CUI behavior components attached to this element (cursor/keyboard, …). Unlike props, these
   * are cross-cutting — the same set applies to any element type — so their codegen lives in one shared
   * place ({@link ElementModifiers}). Absent => no extra components.
   */
  modifiers?: ElementModifiers
}

/**
 * Cross-cutting CUI components that can be attached to ANY element (they aren't tied to one element
 * type the way props are). Emitted by the shared modifier layer, not by the per-type element modules.
 */
export interface ElementModifiers {
  /** NeedsCursor — frees the mouse cursor while this element is shown (needed to click buttons). */
  cursor?: boolean
  /** NeedsKeyboard — captures keyboard focus while shown (needed to type into input fields). */
  keyboard?: boolean
  /** UnityEngine.UI.Outline — a shadow-style outline around this element's graphic. */
  outline?: OutlineModifier
  /** Draggable — the player can drag this element around (Carbon `.SetDraggable` / CuiDraggableComponent). */
  draggable?: DraggableModifier
  /** Slot — an inventory-style drop target (Carbon `.SetSlot` / CuiSlotComponent). */
  slot?: SlotModifier
}

/** Outline modifier: a colored offset outline (Carbon `.SetOutline` / Oxide `CuiOutlineComponent`). */
export interface OutlineModifier {
  color: ColorRGBA
  /** Outline offset in reference px (x, y) — the outline is drawn shifted by this much. */
  distance: Vec2
  /** When true, the outline fades with the graphic's own alpha. */
  useGraphicAlpha?: boolean
}

/** Draggable modifier — fields mirror Carbon `.SetDraggable(...)`; omitted fields use framework defaults. */
export interface DraggableModifier {
  /** Only drop targets whose filter matches accept this element (free-form tag). */
  filter?: string
  /** Allow dropping anywhere, not just on a matching slot (Carbon default true). */
  dropAnywhere?: boolean
  /** Keep this element rendered above its siblings while dragging. */
  keepOnTop?: boolean
  /** Constrain dragging to the parent's rectangle. */
  limitToParent?: boolean
  /** Max drag distance in px; -1 = unlimited. */
  maxDistance?: number
  /** Swap positions with the element dropped onto instead of stacking. */
  allowSwapping?: boolean
}

/** Slot modifier — a drop target; `filter` gates which draggables it accepts. */
export interface SlotModifier {
  filter?: string
}

export interface PanelElement extends BaseElement {
  type: 'panel'
  props: PanelProps
}

export interface TextElement extends BaseElement {
  type: 'text'
  props: TextProps
}

/** Discriminated on `type` — narrow with `el.type === 'text'` to reach type-specific props. */
export type DesignerElement = PanelElement | TextElement | ContainerElement | ButtonElement | InputElement | CountdownElement | TabsElement

/** File ▸ New starters. 'empty' seeds nothing; the rest seed a hand-placed sample composition. */
export type LayoutPreset = 'empty' | 'default' | 'menu' | 'list' | 'tabbed' | 'confirm' | 'hud'

// --- Data sources --------------------------------------------------------------------
//
// A data source is a named, typed static value that lives ALONGSIDE the element tree. In the
// generated *Class* output it becomes a field on the plugin — a shared string, or a collection a
// "template" element repeats over — and bound elements reference it. On every other path (the UX
// snippet, the AddUi JSON, the Selected view, and the live preview) the value is INLINED per element
// (and, for lists, per item), so the preview always ships plain static CUI. Deliberately small for
// now: `text` is wired end-to-end; `list` is modelled for the forthcoming repeat/template work.

export type DataSourceKind = 'text' | 'list'

interface BaseDataSource {
  id: string
  /** Display name; doubles as the generated C# field identifier (sanitised at codegen time). */
  name: string
  kind: DataSourceKind
}

/** A shared string — e.g. a title or label reused by several text elements. */
export interface TextDataSource extends BaseDataSource {
  kind: 'text'
  value: string
}

/** What a list column holds — drives which element props it can bind and how codegen types it.
 *  `text` → string; `itemid` → int (a Rust item id, bindable to an item-icon fill); `url` → string
 *  (bindable to a URL-image fill). */
export type ListColumnKind = 'text' | 'itemid' | 'url'

/** One column of a {@link ListDataSource} — a property of the emitted item struct. */
export interface ListColumn {
  /** Property name in the generated struct (sanitised at codegen time) and the key rows store. */
  key: string
  kind: ListColumnKind
}

/**
 * A static collection a repeating container's template is stamped from: the columns define the item
 * struct (a list IS its own type — codegen emits `class <typeName> { … }` + a `List<typeName>` field
 * seeded with the rows), the rows are the design-time sample data. Values are stored as strings and
 * typed per column kind at emit.
 */
export interface ListDataSource extends BaseDataSource {
  kind: 'list'
  /** C# type name for the emitted item struct, e.g. "MenuEntry". */
  typeName: string
  columns: ListColumn[]
  /** Sample rows, keyed by column key. */
  items: Record<string, string>[]
}

/** Discriminated on `kind`. Narrow with `ds.kind === 'text'` to reach kind-specific fields. */
export type DataSource = TextDataSource | ListDataSource

/**
 * Resolve a text element's effective text: the value of its bound text data source if it has one and
 * the source exists, otherwise the element's own literal `text` prop. Pure — shared by the canvas
 * render and the inline codegen paths so they always agree on what the element displays.
 */
export function resolveText(el: DesignerElement, sources: DataSource[]): string {
  if (el.type !== 'text') return ''
  const dsId = el.bindings?.text
  if (dsId) {
    const ds = sources.find((s) => s.id === dsId)
    if (ds?.kind === 'text') return ds.value
  }
  return el.props.text
}

/**
 * Apply one repeat row to an element: every {@link BaseElement.itemBindings} path whose column exists
 * in `row` overrides the matching prop. Bindable paths: `text` (text-bearing elements), `image.itemId`
 * and `image.url` (panel fills — only when the current fill is of the matching kind, so a binding
 * left over from a previous fill can't corrupt it). Returns the element unchanged when nothing
 * applies. Pure — the canvas ghosts and codegen's expandRepeats share it, so what you see in a slot
 * is exactly what that row emits.
 */
export function applyItemBindings<T extends DesignerElement>(el: T, row: Record<string, string>): T {
  if (!el.itemBindings) return el
  let out = el
  const fork = () => {
    if (out === el) out = { ...el, props: { ...el.props } }
  }
  for (const [path, col] of Object.entries(el.itemBindings)) {
    const v = row[col]
    if (v === undefined) continue
    if (path === 'text' && 'text' in el.props) {
      fork()
      ;(out.props as { text: string }).text = v
    } else if (path === 'image.itemId' || path === 'image.url') {
      const image = (el.props as PanelProps).image
      if (path === 'image.itemId' && image?.kind === 'itemicon') {
        fork()
        ;(out.props as PanelProps).image = { ...image, itemId: Number.parseInt(v, 10) || 0 }
      } else if (path === 'image.url' && image?.kind === 'url') {
        fork()
        ;(out.props as PanelProps).image = { ...image, url: v }
      }
    }
  }
  return out
}

// --- AddUi wire types ----------------------------------------------------------------
//
// The exact JSON shape `CuiHelper.AddUi(player, json)` consumes on the server: a
// CuiElementContainer is just a `CuiElement[]`. These are the canonical types for the
// live-preview transport (issue #3) — `generateAddUiJson` emits them, the diff engine
// consumes them, and the RPC payload ships them verbatim. Field names are the lowercase
// keys the Rust/Oxide CUI deserializer expects; do not rename them.

/** RectTransform component — anchors as "x y" fractions, offsets as "x y" reference px. */
export interface CuiRectTransform {
  type: 'RectTransform'
  anchormin: string
  anchormax: string
  offsetmin: string
  offsetmax: string
}

/**
 * Image fill (the AddUi `UnityEngine.UI.Image` component). `color` is always present (solid fill or
 * image tint); the optional fields select a non-color source (sprite / stored png / item icon). Absent
 * fields are omitted by JSON.stringify, so a plain color panel still serialises as `{ type, color }`.
 */
export interface CuiImageComponent {
  type: 'UnityEngine.UI.Image'
  color: string
  sprite?: string
  png?: string
  // Rust's CUI JSON keys are lowercase — an `itemId`/`skinId` mismatch is silently dropped (and an
  // Image with no resolvable source can null-ref the client's AddUi RPC).
  itemid?: number
  skinid?: number
}

/** URL/raw image fill — `color` is the image tint. Exactly one of the source fields (`url`,
 *  `steamid`, `png`, `sprite`) supplies the texture; the designer emits only url/steamid, but
 *  imported/diffed payloads may carry the others (Oxide's CuiRawImageComponent has all four). */
export interface CuiRawImageComponent {
  type: 'UnityEngine.UI.RawImage'
  url?: string
  steamid?: string
  png?: string
  sprite?: string
  color: string
}

/** Text component (a CuiLabel expands to this + a RectTransform). */
export interface CuiTextComponent {
  type: 'UnityEngine.UI.Text'
  text: string
  fontSize: number
  font: string
  align: TextAlign
  color: string
}

/** Clickable button — `color` is the button image color; `command` runs on click. */
export interface CuiButtonComponent {
  type: 'UnityEngine.UI.Button'
  command: string
  /** Element name destroyed client-side on click (CuiButton.Close) — no server round-trip. */
  close?: string
  color: string
}

/** Editable input field. `command` runs on submit with the typed value appended. */
export interface CuiInputFieldComponent {
  type: 'UnityEngine.UI.InputField'
  text: string
  fontSize: number
  font: string
  align: TextAlign
  color: string
  characterLimit: number
  command: string
  /** Mask the typed value. Omitted when false (matches the LUI/Oxide wire default). */
  password?: boolean
}

/** Client-side countdown timer (pairs with a Text component whose `%TIME_LEFT%` it replaces). */
export interface CuiCountdownComponent {
  type: 'Countdown'
  startTime: number
  endTime: number
  step: number
  command: string
}

/** Behavior components with no fields — presence alone frees the cursor / captures the keyboard. */
export interface CuiNeedsCursorComponent {
  type: 'NeedsCursor'
}
export interface CuiNeedsKeyboardComponent {
  type: 'NeedsKeyboard'
}
export interface CuiOutlineComponent {
  type: 'UnityEngine.UI.Outline'
  color: string
  distance: string
  useGraphicAlpha?: boolean
}
export interface CuiDraggableComponent {
  type: 'Draggable'
  filter?: string
  dropAnywhere?: boolean
  keepOnTop?: boolean
  limitToParent?: boolean
  maxDistance?: number
  allowSwapping?: boolean
}
export interface CuiSlotComponent {
  type: 'Slot'
  filter?: string
}

/** Scrollbar options nested in a scroll view (CuiCore's CuiScrollbar serialization). */
export interface CuiScrollbarWire {
  autoHide?: boolean
  size?: number
  invert?: boolean
  handleColor?: string
  trackColor?: string
}

/** Scroll view wire component — key names match CuiCore's CuiScrollViewComponent JsonProperties. */
export interface CuiScrollViewComponent {
  type: 'UnityEngine.UI.ScrollView'
  vertical: boolean
  horizontal: boolean
  movementType?: 'Unrestricted' | 'Elastic' | 'Clamped'
  contentTransform: { anchormin: string; anchormax: string; offsetmin: string; offsetmax: string }
  verticalScrollbar?: CuiScrollbarWire
  horizontalScrollbar?: CuiScrollbarWire
}

export type CuiComponent =
  | CuiImageComponent
  | CuiRawImageComponent
  | CuiTextComponent
  | CuiButtonComponent
  | CuiInputFieldComponent
  | CuiCountdownComponent
  | CuiNeedsCursorComponent
  | CuiNeedsKeyboardComponent
  | CuiOutlineComponent
  | CuiDraggableComponent
  | CuiSlotComponent
  | CuiScrollViewComponent
  | CuiRectTransform

/**
 * One CUI element. `update: true` patches the element in place (no destroy/recreate, no flicker) —
 * the live-preview transport sets it on every steady-state upsert so re-sending the full snapshot
 * never flashes. Omitted (falsy) on a fresh create.
 */
export interface CuiElement {
  name: string
  parent: string
  components: CuiComponent[]
  update?: boolean
}

/** A resolved rectangle in CUI space (x,y = bottom-left corner, +y up). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type AspectPreset = '16:9' | '16:10' | '21:9' | '4:3' | '32:9'

/**
 * The canvas models Rust's CUI canvas scaler: a fixed **1280×720 (16:9) reference resolution** in
 * Unity's **Expand** screen-match mode — `scale = min(screenW/1280, screenH/720)`, so the canvas pins
 * whichever dimension is more constrained (width below 16:9, height above it) and lets the other grow.
 * The effective per-aspect canvas dimensions are `geometry.canvasWidth` / `geometry.canvasHeight`.
 *
 * NOTE: earlier passes modelled this as pure match-height (constant 720) and then pure match-width
 * (constant 1280) — each matched in-game at only some aspects. Expand is the correct rule; verified
 * against in-game 4:3 (1280×960) and ultrawide (height stays 720) captures. The reference height is
 * geometry.ts's fixed constant — older builds persisted it per-layout as `referenceHeight` (and
 * briefly `referenceWidth`); those fields are stripped on load.
 */
export interface CanvasConfig {
  aspect: AspectPreset
  /** Rust client UI layer the root attaches to (drives the generated parent). */
  rootLayer: ClientPanel
  /** Name of the generated root container; blank/absent means the "Container" default. It is what
   *  the plugin targets for DestroyUi, so a per-plugin name (e.g. "MyPlugin.Root") avoids clashes. */
  rootName?: string
}

export const ASPECT_RATIOS: Record<AspectPreset, [number, number]> = {
  '16:9': [16, 9],
  '16:10': [16, 10],
  '21:9': [21, 9],
  '4:3': [4, 3],
  '32:9': [32, 9],
}

export const ASPECT_PRESETS = Object.keys(ASPECT_RATIOS) as AspectPreset[]
