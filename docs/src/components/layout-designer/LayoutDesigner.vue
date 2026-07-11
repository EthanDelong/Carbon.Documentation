<script setup lang="ts">
import './fonts/index.css' // self-hosted Rust CUI fonts; here so they load on the tool page only
import { useEventListener, useStorage } from '@vueuse/core'
import { Check, ChevronRight, Clipboard, ClipboardPaste, Folder, FolderInput, FolderOpen, Lock, Pencil, Plus, Redo2, RotateCcw, Settings, Shapes, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import ContextMenu from './ContextMenu.vue'
import DockNode from './DockNode.vue'
import InfoTip from './InfoTip.vue'
import HelpModal from './HelpModal.vue'
import LayoutSettingsModal from './LayoutSettingsModal.vue'
import LivePreviewControls from './LivePreviewControls.vue'
import { PANE_TITLES, leavesOf, locate, type DockSide, type PaneId } from './dockTree'
import { ASPECT_PRESETS, CLIENT_PANELS, type AspectPreset, type ClientPanel, type LayoutPreset } from './types'
import { ZOOM_STEP, useCanvasView } from './useCanvasView'
import { useDesigner } from './useDesigner'
import { comboFromEvent, comboLabel, isTypingTarget, useKeybinds, type KeyActionId } from './useKeybinds'
import { collectPreviewImageIds, useLocalImages } from './useLocalImages'
import { useDock } from './useDock'
import { useScreenShare } from './useScreenShare'
import { useDockDrag } from './useDockDrag'

const {
  canvas,
  gridSize,
  constrain,
  setCanvas,
  init,
  selectedIds,
  removeSelected,
  duplicateSelected,
  groupSelection,
  ungroupSelection,
  nudge,
  undo,
  redo,
  canUndo,
  canRedo,
  layouts,
  currentLayoutId,
  openTabLayouts,
  recentLayouts,
  closeAllTabs,
  newLayout,
  switchLayout,
  renameLayout,
  setLayoutFolder,
  deleteLayout,
  exportClipboard,
  importClipboard,
  loadExampleLayouts,
} = useDesigner()

function fileCloseAll() {
  closeAllTabs()
  closeFileMenu()
}

const GRID_SIZES = [1, 2, 4, 8, 16, 32]

const { gcLocalImages } = useLocalImages()

onMounted(() => {
  // The docs apply a global noise/speckle overlay (body::after, color-dodge) over the page;
  // it must not bleed into the canvas preview. Tag the body so we can suppress it (unscoped
  // <style> below), restored on navigate-away.
  document.body.classList.add('layout-designer-page')
  init()
  // Local preview images that no layout references anymore (deleted layouts/elements, replaced
  // files) are dead weight in a small storage budget -- sweep them once per session. Right after
  // init() the live tree equals the loaded store, so the layouts alone are the full reference set.
  gcLocalImages(collectPreviewImageIds(layouts.value.map((l) => l.data)))
})
onBeforeUnmount(() => {
  document.body.classList.remove('layout-designer-page')
})

// --- menus (File menu + View menu + Help) ---
const fileMenuOpen = ref(false)
const newFlyoutOpen = ref(false)
const loadFlyoutOpen = ref(false)
const viewMenuOpen = ref(false)
const settingsModalOpen = ref(false)
const helpModalOpen = ref(false)

// Flyouts (New / Load) open on hover. A short close-delay bridges the gap between a row and its
// flyout so moving the mouse diagonally onto the submenu doesn't dismiss it (the timer is cancelled
// the moment the pointer re-enters either the row or the flyout, which is a descendant of the row).
let flyoutTimer: ReturnType<typeof setTimeout> | null = null
function clearFlyoutTimer() {
  if (flyoutTimer) {
    clearTimeout(flyoutTimer)
    flyoutTimer = null
  }
}
function openFlyout(which: 'new' | 'load') {
  clearFlyoutTimer()
  newFlyoutOpen.value = which === 'new'
  loadFlyoutOpen.value = which === 'load'
}
function scheduleFlyoutClose() {
  clearFlyoutTimer()
  flyoutTimer = setTimeout(() => {
    newFlyoutOpen.value = false
    loadFlyoutOpen.value = false
    flyoutTimer = null
  }, 180)
}

function closeFileMenu() {
  clearFlyoutTimer()
  fileMenuOpen.value = false
  newFlyoutOpen.value = false
  loadFlyoutOpen.value = false
}

// File ▸ New presets. Each id maps to a seeder in useDesigner (newLayout); 'empty' starts blank.
const NEW_PRESETS: { id: LayoutPreset; name: string; hint: string }[] = [
  { id: 'empty', name: 'Empty', hint: 'A blank layout' },
  { id: 'default', name: 'Window', hint: 'A working window: title bar, close button, body text and an OK button (both dismiss client-side)' },
  { id: 'confirm', name: 'Confirm dialog', hint: 'Message + Cancel (closes) and Confirm (runs a command) - the yes/no popup' },
  { id: 'menu', name: 'Menu', hint: 'A centered menu: title bar with title + close button, and one action button' },
  { id: 'tabbed', name: 'Tabbed menu', hint: 'The window with a tab view: two pages and their switch buttons, ready to fill' },
  { id: 'list', name: 'List menu', hint: 'The menu window with a scrolling, repeating kit list bound to a sample data source' },
  { id: 'hud', name: 'HUD status', hint: 'A passive icon + text strip on the Hud layer (no cursor capture) - server info, event timers' },
]
function fileNew(preset: LayoutPreset) {
  newLayout(undefined, preset) // auto-named "Layout N"; rename via the pencil
  closeFileMenu()
}
function chooseLayout(id: string) {
  switchLayout(id)
  closeFileMenu()
}
function fileImport() {
  importClipboard()
  closeFileMenu()
}
function fileLoadExamples() {
  loadExampleLayouts()
  closeFileMenu()
}
function fileExport() {
  exportClipboard()
  closeFileMenu()
}
function doRename(id: string, current: string) {
  const name = window.prompt('Rename layout', current)
  if (name !== null && name.trim()) renameLayout(id, name.trim())
}
function doDelete(id: string, name: string) {
  if (window.confirm(`Delete layout "${name}"?`)) deleteLayout(id)
}
// Grouped for the Load selector (#10): ungrouped first, then folders alphabetically.
const groupedLayouts = computed(() => {
  const groups = new Map<string, typeof layouts.value>()
  const ungrouped: typeof layouts.value = []
  for (const l of layouts.value) {
    if (l.folder) groups.set(l.folder, [...(groups.get(l.folder) ?? []), l])
    else ungrouped.push(l)
  }
  const out: { folder: string | null; items: typeof layouts.value }[] = []
  if (ungrouped.length) out.push({ folder: null, items: ungrouped })
  for (const folder of [...groups.keys()].sort((a, b) => a.localeCompare(b))) out.push({ folder, items: groups.get(folder)! })
  return out
})
function doMoveToFolder(id: string, current?: string) {
  const existing = [...new Set(layouts.value.map((l) => l.folder).filter(Boolean))].sort()
  const hint = existing.length ? `Move to folder (existing: ${existing.join(', ')}). Blank to ungroup.` : 'Move to folder — blank to ungroup.'
  const folder = window.prompt(hint, current ?? '')
  if (folder !== null) setLayoutFolder(id, folder)
}

// --- keyboard shortcuts ---
// Shortcuts are data-driven (Settings → Keyboard shortcuts can rebind them); arrow-nudge stays fixed.
const { actionForCombo, bindingFor } = useKeybinds()
function runKeyAction(id: KeyActionId) {
  if (id === 'undo') undo()
  else if (id === 'redo') redo()
  else if (id === 'duplicate') duplicateSelected()
  else if (id === 'group') groupSelection()
  else if (id === 'ungroup') ungroupSelection()
  else if (id === 'delete') removeSelected()
  else if (id === 'zoomIn') canvasZoomAt(0, 0, ZOOM_STEP)
  else if (id === 'zoomOut') canvasZoomAt(0, 0, 1 / ZOOM_STEP)
  else if (id === 'zoomReset') canvasResetView()
}
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (isTypingTarget(e)) return
  const action = actionForCombo(comboFromEvent(e))
  if (action) {
    if (action === 'delete' && !selectedIds.value.length) return
    e.preventDefault()
    runKeyAction(action)
    return
  }
  if (!selectedIds.value.length) return
  const step = e.shiftKey ? (gridSize.value || 1) * 5 : gridSize.value || 1
  if (e.key === 'ArrowLeft') (e.preventDefault(), nudge(-step, 0))
  else if (e.key === 'ArrowRight') (e.preventDefault(), nudge(step, 0))
  else if (e.key === 'ArrowUp') (e.preventDefault(), nudge(0, step)) // CUI y is up
  else if (e.key === 'ArrowDown') (e.preventDefault(), nudge(0, -step))
})

// close popovers on outside click (capture: canvas elements stopPropagation on pointerdown)
useEventListener(
  window,
  'pointerdown',
  (e: PointerEvent) => {
    const t = e.target as HTMLElement
    if (!t.closest('.ld-file-menu')) closeFileMenu()
    if (!t.closest('.ld-view-menu')) viewMenuOpen.value = false
  },
  true
)

// --- pane visibility (the View menu; show/hide each aux pane, persisted) ---
type PaneKey = 'project' | 'elements' | 'dataSources' | 'inspector' | 'code' | 'debug' | 'screenShare'
// Screen Share is an OPTIONAL pane (added on demand, see addScreenShare) — it only appears in View
// once it's in the dock tree, so the View menu is computed from the current tree.
const VIEW_PANES = computed<{ key: PaneKey; label: string }[]>(() => {
  const list: { key: PaneKey; label: string }[] = [
    { key: 'project', label: 'Project' },
    { key: 'elements', label: 'Elements' },
    { key: 'dataSources', label: 'Data Sources' },
    { key: 'inspector', label: 'Inspector' },
    { key: 'code', label: 'Code' },
    { key: 'debug', label: 'Debug' },
  ]
  if (leavesOf(tree.value).includes('screenShare')) list.push({ key: 'screenShare', label: 'Screen Share' })
  return list
})
// Since #9 the tree is the single source of truth: a pane is "shown" iff it's a leaf in it. View hides
// a pane by *removing* it (remembering where it sat) and shows it by re-docking — no parallel
// visibility flag, so a hidden pane can't reserve empty space (the old "blank hole").
const { tree, addPane, closePane, resetTree } = useDock()

const isShown = (key: PaneKey) => leavesOf(tree.value).includes(key)

// Toolbar controls the View menu can show/hide (the secondary ones also reachable in File → Settings).
// Stored as overrides; a control is shown unless explicitly turned off, so a missing/empty store is safe.
const toolbarStore = useStorage<Record<string, boolean>>('carbon-layout-designer:workspace:toolbar', {})
const tbShown = (key: string) => toolbarStore.value?.[key] !== false
const tbToggle = (key: string) => (toolbarStore.value = { ...(toolbarStore.value ?? {}), [key]: !tbShown(key) })
const TOOLBAR_TOGGLES = [
  { key: 'history', label: 'Undo / Redo' },
  { key: 'aspect', label: 'Aspect' },
  { key: 'zoom', label: 'Zoom' },
  { key: 'layer', label: 'Layer' },
  { key: 'root', label: 'Root name' },
  { key: 'grid', label: 'Grid' },
  { key: 'bounds', label: 'Bounds' },
]

// Canvas zoom (the canvas owns wheel/MMB/Space interactions; these are the toolbar controls)
const { zoom: canvasZoom, zoomAt: canvasZoomAt, resetView: canvasResetView } = useCanvasView()

// The trimmed value is written back to the input too: when trimming yields the already-stored
// name, the :value binding sees no reactive change and would leave the untrimmed text on screen.
function setRootName(e: Event) {
  const input = e.target as HTMLInputElement
  const rootName = input.value.trim()
  setCanvas({ rootName })
  input.value = rootName
}

// Last spot each hidden pane occupied, so re-showing lands it back where it was. Persisted so it
// survives reloads; falls back to a sensible default home when the remembered neighbour is gone.
const hiddenSpots = useStorage<Partial<Record<PaneKey, { target: PaneId; side: DockSide }>>>('carbon-layout-designer:workspace:hiddenSpots', {}, undefined)
const DEFAULT_HOME: Record<PaneKey, { target: PaneId; side: DockSide }> = {
  project: { target: 'canvas', side: 'left' },
  elements: { target: 'canvas', side: 'left' },
  dataSources: { target: 'canvas', side: 'left' },
  inspector: { target: 'canvas', side: 'right' },
  code: { target: 'canvas', side: 'bottom' },
  debug: { target: 'canvas', side: 'bottom' },
  screenShare: { target: 'canvas', side: 'right' },
}

function hidePane(key: PaneKey) {
  const spot = locate(tree.value, key)
  if (spot) hiddenSpots.value[key] = spot
  // Removing the Screen Share pane ends the capture, so the design opacity returns to normal (popping out
  // leaves the pane in the tree, so this only fires on a genuine close — not a pop-out).
  if (key === 'screenShare') stopScreenShare()
  closePane(key)
}
function showPane(key: PaneKey) {
  const spot = hiddenSpots.value[key]
  if (spot && isShown(spot.target)) addPane(key, spot.target, spot.side)
  if (!isShown(key)) {
    const home = DEFAULT_HOME[key] // canvas is always present, so this always lands
    addPane(key, home.target, home.side)
  }
  delete hiddenSpots.value[key]
}
// Hiding a popped-out pane removes its DockLeaf, which closes the PiP window via usePopout cleanup.
function togglePane(key: PaneKey) {
  if (isShown(key)) hidePane(key)
  else showPane(key)
}

// Recover from a stranded/odd workspace in one click: default tree + every pane shown.
function resetWorkspaceLayout() {
  resetTree()
  hiddenSpots.value = {}
  viewMenuOpen.value = false
}

// --- screen share (issue #7): an opt-in local screen-capture pane, added on demand ---
const { supported: screenShareSupported, stop: stopScreenShare } = useScreenShare()
/** Add the Screen Share pane to the right of the canvas, where it splits off a collapsible edge strip.
 *  No-op if it's already docked. */
function addScreenShare() {
  addPane('screenShare', 'canvas', 'right')
}
// Let LivePreviewControls (and anyone else) offer the action without reaching into the dock/visibility.
provide('ld-screen-share', { supported: screenShareSupported, add: addScreenShare })
// Close-a-pane handle for pane headers (framed panes' X, and the self-framed Code/Debug headers). Uses
// hidePane so the pane remembers its spot and comes back where it was when re-shown from View.
provide('ld-pane-close', (key: PaneKey) => hidePane(key))

// drag-docking (2b): a floating ghost that follows the cursor while a pane is being dragged
const { dragging: dockDragging, pointer: dockPointer } = useDockDrag()
</script>

<template>
  <div class="ld-root">
    <!-- toolbar -->
    <div class="ld-toolbar">
      <span class="ld-title">Layout Designer</span>

      <!-- File menu (new / load / import / export / recent) -->
      <div class="ld-file-menu">
        <button class="ld-menubar-btn" :class="{ open: fileMenuOpen }" title="File" @click.stop="fileMenuOpen = !fileMenuOpen">File</button>
        <div v-if="fileMenuOpen" class="ld-menu-pop" @pointerdown.stop>
          <!-- New: flyout of starter presets (Empty / Default / …) -->
          <div class="ld-menu-flyout-anchor" @pointerenter="openFlyout('new')" @pointerleave="scheduleFlyoutClose">
            <button class="ld-menu-item" :class="{ active: newFlyoutOpen }">
              <Plus :size="13" /> <span class="ld-menu-name">New</span> <ChevronRight :size="13" />
            </button>
            <div v-if="newFlyoutOpen" class="ld-menu-pop ld-menu-flyout" @pointerdown.stop>
              <button v-for="p in NEW_PRESETS" :key="p.id" class="ld-menu-item" :title="p.hint" @click="fileNew(p.id)">
                <span class="ld-menu-name">{{ p.name }}</span>
              </button>
            </div>
          </div>

          <!-- Load: flyout of every saved layout, grouped into folders (#10); rename / move / delete inline -->
          <div class="ld-menu-flyout-anchor" @pointerenter="openFlyout('load')" @pointerleave="scheduleFlyoutClose">
            <button class="ld-menu-item" :class="{ active: loadFlyoutOpen }">
              <FolderOpen :size="13" /> <span class="ld-menu-name">Load</span> <ChevronRight :size="13" />
            </button>
            <div v-if="loadFlyoutOpen" class="ld-menu-pop ld-menu-flyout" @pointerdown.stop>
              <template v-for="g in groupedLayouts" :key="g.folder ?? '__ungrouped'">
                <div v-if="g.folder" class="ld-menu-section ld-folder-head"><Folder :size="11" /> {{ g.folder }}</div>
                <button
                  v-for="l in g.items"
                  :key="l.id"
                  class="ld-menu-item"
                  :class="{ active: l.id === currentLayoutId, 'ld-in-folder': g.folder }"
                  @click="chooseLayout(l.id)"
                >
                  <span class="ld-menu-name">{{ l.name }}</span>
                  <span class="ld-menu-row-actions">
                    <FolderInput :size="12" title="Move to folder" @click.stop="doMoveToFolder(l.id, l.folder)" />
                    <Pencil :size="12" title="Rename" @click.stop="doRename(l.id, l.name)" />
                    <Trash2 :size="12" title="Delete" @click.stop="doDelete(l.id, l.name)" />
                  </span>
                </button>
              </template>
              <div v-if="!layouts.length" class="ld-menu-section">No saved layouts yet.</div>
            </div>
          </div>

          <div class="ld-menu-sep" />
          <button class="ld-menu-item" title="Accepts a designer export or raw CUI JSON from a plugin's CuiElementContainer.ToJson()" @click="fileImport"><ClipboardPaste :size="13" /> Import from clipboard</button>
          <button class="ld-menu-item" @click="fileExport"><Clipboard :size="13" /> Export to clipboard</button>
          <button class="ld-menu-item" title="Load example layouts — one per element type, fill and modifier — as tabs in an Examples folder" @click="fileLoadExamples"><Shapes :size="13" /> Load examples</button>

          <div class="ld-menu-sep" />
          <button class="ld-menu-item" :disabled="!openTabLayouts.length" title="Close all open layout tabs (the layouts are kept)" @click="fileCloseAll"><X :size="13" /> Close All</button>

          <div class="ld-menu-sep" />
          <button class="ld-menu-item" title="Editor options & customizable keyboard shortcuts" @click="(settingsModalOpen = true), closeFileMenu()"><Settings :size="13" /> Settings</button>

          <template v-if="recentLayouts.length">
            <div class="ld-menu-sep" />
            <div class="ld-menu-section">Recent</div>
            <button v-for="(l, i) in recentLayouts" :key="l.id" class="ld-menu-item" @click="chooseLayout(l.id)">
              <span class="ld-menu-recent-idx">{{ i + 1 }}</span>
              <span class="ld-menu-name">{{ l.name }}</span>
            </button>
          </template>
        </div>
      </div>

      <!-- View menu (show / hide each aux pane) -->
      <div class="ld-view-menu">
        <button class="ld-menubar-btn" :class="{ open: viewMenuOpen }" title="View" @click.stop="viewMenuOpen = !viewMenuOpen">View</button>
        <div v-if="viewMenuOpen" class="ld-menu-pop" @pointerdown.stop>
          <button v-for="p in VIEW_PANES" :key="p.key" class="ld-menu-item ld-menu-check" @click="togglePane(p.key)">
            <Check v-if="isShown(p.key)" :size="13" class="ld-check-on" />
            <span v-else class="ld-check-spacer" />
            <span class="ld-menu-name">{{ p.label }}</span>
          </button>
          <div class="ld-menu-sep" />
          <div class="ld-menu-section">Toolbar</div>
          <button v-for="t in TOOLBAR_TOGGLES" :key="t.key" class="ld-menu-item ld-menu-check" @click="tbToggle(t.key)">
            <Check v-if="tbShown(t.key)" :size="13" class="ld-check-on" />
            <span v-else class="ld-check-spacer" />
            <span class="ld-menu-name">{{ t.label }}</span>
          </button>
          <div class="ld-menu-sep" />
          <button class="ld-menu-item" title="Restore the default pane arrangement and show every pane" @click="resetWorkspaceLayout">
            <RotateCcw :size="13" /> <span class="ld-menu-name">Reset Layout</span>
          </button>
        </div>
      </div>

      <button class="ld-menubar-btn" title="Help — what every element, fill and modifier does" @click.stop="helpModalOpen = true">Help</button>


      <template v-if="tbShown('history')">
        <button class="ld-icon-btn" :disabled="!canUndo" title="Undo" @click="undo"><Undo2 :size="15" /></button>
        <button class="ld-icon-btn" :disabled="!canRedo" title="Redo" @click="redo"><Redo2 :size="15" /></button>
      </template>

      <LivePreviewControls />

      <div class="ld-spacer" />

      <div v-if="tbShown('aspect')" class="ld-tool-field">
        <span>Aspect</span>
        <div class="ld-segmented ld-collapsible" role="group" aria-label="Aspect ratio">
          <button
            v-for="a in ASPECT_PRESETS"
            :key="a"
            :class="{ active: canvas.aspect === a }"
            :title="`Preview at ${a}`"
            @click="setCanvas({ aspect: a })"
          >
            {{ a }}
          </button>
        </div>
        <!-- collapsed form when the toolbar is narrow (see media query below) -->
        <select
          class="ld-collapsed-select"
          :value="canvas.aspect"
          title="Preview aspect ratio"
          @change="setCanvas({ aspect: ($event.target as HTMLSelectElement).value as AspectPreset })"
        >
          <option v-for="a in ASPECT_PRESETS" :key="a" :value="a">{{ a }}</option>
        </select>
        <InfoTip text="The screen shape to preview. Switching it shows how the layout responds: relative (anchored/stretched) elements reflow, while fixed-px elements keep their reference size." />
      </div>


      <div v-if="tbShown('zoom')" class="ld-tool-field">
        <span>Zoom</span>
        <button class="ld-icon-btn" :title="`Zoom out (${comboLabel(bindingFor('zoomOut'))})`" @click="runKeyAction('zoomOut')"><ZoomOut :size="15" /></button>
        <button class="ld-zoom-pct" :class="{ zoomed: Math.round(canvasZoom * 100) !== 100 }" :title="`Reset zoom to fit (${comboLabel(bindingFor('zoomReset'))})`" @click="runKeyAction('zoomReset')">{{ Math.round(canvasZoom * 100) }}%</button>
        <button class="ld-icon-btn" :title="`Zoom in (${comboLabel(bindingFor('zoomIn'))})`" @click="runKeyAction('zoomIn')"><ZoomIn :size="15" /></button>
        <InfoTip text="Canvas zoom — view only, never part of the layout or the generated code. Mouse wheel over the canvas zooms at the cursor; middle-mouse (or Space) drag pans; zoom keys are rebindable in File > Settings. Click the percentage to reset to fit." />
      </div>

      <label v-if="tbShown('layer')" class="ld-tool-field">
        <span>Layer</span>
        <select
          :value="canvas.rootLayer"
          title="Rust client UI layer the root attaches to"
          @change="setCanvas({ rootLayer: ($event.target as HTMLSelectElement).value as ClientPanel })"
        >
          <option v-for="p in CLIENT_PANELS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <InfoTip text="The Rust client UI layer the root of your layout attaches to. Oxide parents root elements to this layer string; Carbon emits cui.v2.CreateParent(CUI.ClientPanels.X). Overlay is the standard full-screen menu layer." />
      </label>

      <label v-if="tbShown('root')" class="ld-tool-field">
        <span>Root</span>
        <input
          class="ld-root-name"
          type="text"
          :value="canvas.rootName ?? ''"
          placeholder="Container"
          spellcheck="false"
          title="Name of the generated root container"
          @change="setRootName($event)"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <InfoTip text="The generated root container's name — what the plugin targets for DestroyUi (the Hide command) and what Carbon's CreateParent creates. Blank uses the 'Container' default; a per-plugin name like 'MyPlugin.Root' avoids clashing with other plugins' UIs. If an element already uses the name, the root gets a numeric suffix." />
      </label>

      <label v-if="tbShown('grid')" class="ld-tool-field">
        <span>Grid</span>
        <select
          :value="gridSize"
          title="Snap grid in pixels. Drag/resize land on multiples — keeps values clean (no fractions)."
          @change="gridSize = Number(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="g in GRID_SIZES" :key="g" :value="g">{{ g }}px</option>
        </select>
        <InfoTip text="Snap grid in reference pixels. Dragging and resizing land on multiples of this, so offsets stay whole numbers. Use 1px for fine control." />
      </label>

      <template v-if="tbShown('bounds')">
        <button
          class="ld-btn"
          :class="{ toggled: constrain }"
          :title="constrain ? 'Bounds on: elements stay inside their parent' : 'Bounds off: elements may overflow'"
          @click="constrain = !constrain"
        >
          <Lock :size="14" /> Bounds
        </button>
        <InfoTip text="When on, elements can't be dragged or resized outside their parent, and root panels stay within the canvas." />
      </template>


    </div>

    <!-- body: recursive dock tree (tool panes around the pinned centre canvas) -->
    <div class="ld-body">
      <DockNode :node="tree" />
    </div>

    <!-- drag-docking ghost: a label that tracks the cursor while a pane is dragged -->
    <Teleport to="body">
      <div v-if="dockDragging" class="ld-dock-ghost" :style="{ left: dockPointer.x + 14 + 'px', top: dockPointer.y + 14 + 'px' }">
        {{ PANE_TITLES[dockDragging] }}
      </div>
    </Teleport>

    <ContextMenu />

    <Teleport to="body">
      <LayoutSettingsModal v-if="settingsModalOpen" @close="settingsModalOpen = false" />
    </Teleport>

    <Teleport to="body">
      <HelpModal v-if="helpModalOpen" @close="helpModalOpen = false" />
    </Teleport>
  </div>
</template>

<style scoped>
.ld-root {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--vp-nav-height));
  background: var(--c-carbon-bg-dark);
  color: var(--vp-c-text-1);
  font-size: 14px;
}

/* toolbar */
.ld-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap; /* below the collapse breakpoint, controls wrap as whole units to a 2nd row */
  gap: 8px 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  flex-shrink: 0;
}

/* keep control labels on one line — let whole controls wrap instead of their text */
.ld-btn,
.ld-tool-field,
.ld-tool-field span {
  white-space: nowrap;
}

.ld-title {
  font-weight: 700;
  font-size: 15px;
}

.ld-spacer {
  flex: 1;
}

.ld-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 4px;
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.ld-btn:hover {
  border-color: var(--c-carbon-1);
}

.ld-btn.primary {
  background: var(--c-carbon-1);
  border-color: var(--c-carbon-1);
  color: #fff;
}

.ld-btn.toggled {
  background: var(--c-carbon-soft);
  border-color: var(--c-carbon-1);
  color: var(--c-carbon-1);
}

.ld-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-2);
}

.ld-icon-btn:hover:not(:disabled) {
  border-color: var(--c-carbon-1);
  color: var(--vp-c-text-1);
}

.ld-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* zoom percentage readout — click resets to fit */
.ld-zoom-pct {
  min-width: 44px;
  height: 30px;
  padding: 0 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-2);
}

.ld-zoom-pct:hover {
  border-color: var(--c-carbon-1);
  color: var(--vp-c-text-1);
}

.ld-zoom-pct.zoomed {
  color: var(--c-carbon-1);
}

/* root container name — free text, kept narrow like the selects around it */
.ld-root-name {
  width: 108px;
  padding: 4px 7px;
  font-size: 12.5px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  outline: none;
}

.ld-root-name:focus {
  border-color: var(--c-carbon-1);
}

/* dropdown menus (layouts) */
.ld-file-menu,
.ld-view-menu {
  position: relative;
  display: inline-flex;
}

/* View menu: checkable pane toggles (Check icon when shown, spacer keeps labels aligned) */
.ld-menu-check {
  gap: 7px;
}

.ld-check-spacer {
  display: inline-block;
  width: 13px;
}

.ld-check-on {
  color: var(--c-carbon-1);
}

/* menu-bar style trigger (File / View) — borderless text, distinct from the bordered .ld-btn */
.ld-menubar-btn {
  padding: 5px 10px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 4px;
  color: var(--vp-c-text-1);
}

.ld-menubar-btn:hover,
.ld-menubar-btn.open {
  background: var(--c-carbon-soft);
}

/* a File-menu row that opens a side flyout (New / Load) */
.ld-menu-flyout-anchor {
  position: relative;
}

/* two classes → outranks the base .ld-menu-pop (top:100%/left:0) regardless of source order,
   so the flyout sits to the right of its row instead of dropping below it */
.ld-menu-pop.ld-menu-flyout {
  top: -6px;
  left: calc(100% + 3px);
  min-width: 200px;
}

.ld-menu-section {
  padding: 5px 9px 3px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
}

/* folder grouping in the Load selector (#10) */
.ld-folder-head {
  display: flex;
  align-items: center;
  gap: 5px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--vp-c-text-2);
}

.ld-menu-item.ld-in-folder {
  padding-left: 22px; /* nest layouts under their folder header */
}

.ld-menu-recent-idx {
  width: 13px;
  text-align: right;
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
}

.ld-menu-item:disabled {
  opacity: 0.4;
  cursor: default;
}

.ld-menu-item:disabled:hover {
  background: none;
}

.ld-menu-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 80;
  min-width: 220px;
  padding: 5px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
}

.ld-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  font-size: 13px;
  color: var(--vp-c-text-1);
  border-radius: 4px;
  text-align: left;
}

.ld-menu-item:hover {
  background: var(--c-carbon-soft);
}

.ld-menu-item.active {
  color: var(--c-carbon-1);
}

.ld-menu-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ld-menu-row-actions {
  display: flex;
  gap: 8px;
  opacity: 0;
  color: var(--vp-c-text-3);
}

.ld-menu-item:hover .ld-menu-row-actions {
  opacity: 1;
}

.ld-menu-row-actions :deep(svg):hover {
  color: var(--c-carbon-1);
}

.ld-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--vp-c-divider);
}

.ld-btn.primary:hover {
  background: var(--c-carbon-3);
}

/* add-element button + its type menu anchor */
.ld-add-menu {
  position: relative;
  display: inline-flex;
}

.ld-tool-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.ld-tool-field select,
.ld-tool-field input {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  padding: 4px 6px;
  color: var(--vp-c-text-1);
  font-size: 13px;
}

.ld-tool-field input {
  width: 72px;
}

.ld-segmented {
  display: inline-flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  overflow: hidden;
}

.ld-segmented button {
  padding: 5px 12px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border-right: 1px solid var(--vp-c-divider);
}

.ld-segmented button:last-child {
  border-right: none;
}

.ld-segmented button.active {
  background: var(--c-carbon-1);
  color: #fff;
}

/* Responsive: the Aspect and Target segmented controls need ~1642px of toolbar; below that they
   collapse into compact <select> dropdowns so the toolbar stays a single row down to ~1349px. */
.ld-collapsed-select,
.ld-collapsed-label {
  display: none;
}

@media (max-width: 1660px) {
  .ld-collapsible {
    display: none;
  }
  .ld-collapsed-select {
    display: inline-block;
  }
  .ld-collapsed-label {
    display: inline;
  }
}

/* body */
.ld-body {
  display: flex;
  flex: 1;
  min-height: 0;
  /* escape valve when fixed columns + min-width canvas exceed the viewport (narrow screens) */
  overflow-x: auto;
}

/* floating drag-docking ghost (teleported to body, so it rides above everything) */
.ld-dock-ghost {
  position: fixed;
  z-index: 3000;
  pointer-events: none;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--c-carbon-1);
  border-radius: 4px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 35%);
}

</style>

<!-- Unscoped: suppress the docs' global noise/speckle overlay while the designer is open so
     the canvas preview shows the solid colors that Rust actually renders. -->
<style>
body.layout-designer-page::after {
  display: none !important;
}

/* The designer fills the viewport (`.ld-root` = 100vh - nav), so the site footer below it would push
   a scrollbar. Hide it on this full-bleed tool page; the class is removed on navigate-away. */
body.layout-designer-page .VPFooter {
  display: none;
}
</style>
