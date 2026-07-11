<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import { Check, Copy, Download, PictureInPicture2, X } from 'lucide-vue-next'
import { computed, inject, ref, watch } from 'vue'
import { copyText } from './clipboard'
import { generateCode, generateFullClass, generateJson, generateSelected } from './codegen'
import { usePopout } from './usePopout'
import { useShiki } from './useShiki'
import { useDesigner } from './useDesigner'
import { localImageBytes, useLocalImages } from './useLocalImages'
import { buildZip, type ZipEntry } from './zipStore'

const { elements, dataSources, canvas, provider, selectedIds, currentLayoutName } = useDesigner()
const { getLocalImage } = useLocalImages()

// Emission level. Target (Oxide/Carbon/Both) applies to class/ux/selected; json is
// provider-independent (the CUI wire format). The captured IR lives in its own Debug pane.
type Tab = 'class' | 'ux' | 'json' | 'selected'
const TABS: { id: Tab; label: string }[] = [
  { id: 'class', label: 'Class' },
  { id: 'ux', label: 'UX' },
  { id: 'selected', label: 'Selected' },
  { id: 'json', label: 'JSON' },
]
// Display order/labels only; the stored provider value 'both' is unchanged (codegen reads the value).
const PROVIDERS = [
  { value: 'carbon', label: 'Carbon' },
  { value: 'oxide', label: 'Oxide' },
  { value: 'both', label: 'Hybrid' },
] as const
const tab = ref<Tab>('ux')
const targetApplies = computed(() => tab.value === 'class' || tab.value === 'ux' || tab.value === 'selected')

const { supported: popoutSupported, pipTarget, toggle: togglePopout, close: closePopout } = usePopout(() => 'Code', { width: 520, height: 640 })
const closePaneFn = inject<(pane: 'code') => void>('ld-pane-close')

// Generate the current tab's code eagerly from the live state. Pure read of the reactive sources —
// call it whenever an up-to-the-moment string is needed (the debounced pane ref below, and copy()).
function generateActive(): string {
  switch (tab.value) {
    case 'class':
      return generateFullClass(elements.value, provider.value, canvas.rootLayer, dataSources.value, canvas.rootName)
    case 'json':
      return generateJson(elements.value, canvas.rootLayer, dataSources.value, canvas.rootName)
    case 'selected':
      return generateSelected(elements.value, selectedIds.value, provider.value, canvas.rootLayer, dataSources.value, canvas.rootName)
    default:
      return generateCode(elements.value, provider.value, canvas.rootLayer, dataSources.value, { rootName: canvas.rootName })
  }
}

// The pane's code, refreshed at the debounced cadence (below) rather than per mutation.
const active = ref('')
function refresh() {
  active.value = generateActive()
}

// Debounce the INPUT to generation, not just the highlighter's input. generateActive() walks the whole
// element tree, and a drag mutates elements at ~60fps. We watch the RAW sources here — deliberately not
// a computed<string> over generateActive(): a watcher on a computed defeats its laziness (the watcher
// forces the computed to re-run generateCode on every invalidation, i.e. every pointermove), which is
// the very cost we're removing. Deep, because edits mutate nested element/data-source props.
watchDebounced([elements, dataSources, canvas, selectedIds], refresh, { deep: true, debounce: 60 })
// Discrete UI switches refresh immediately — tab switch shows the new tab's code with no 60ms blank/stale
// flash, and a provider/target change updates the pane at once.
watch([tab, provider], refresh)
refresh() // initial synchronous fill (no blank frame before the first debounce could fire)

// JSON tab is JSON; the rest are C#. Highlighting runs ONLY on the Selected tab: Shiki re-tokenizing
// a full Class/UX/JSON dump (an 18-page tabbed layout generates thousands of lines) on every edit or
// tab switch is what made switching feel slow — the big tabs render as plain text instead.
const lang = computed(() => (tab.value === 'json' ? 'json' : 'csharp'))
const { html } = useShiki(() => (tab.value === 'selected' ? active.value : ''), lang)

// Download the generated plugin as a file. With local preview images attached to fills, the
// download becomes a zip: the .cs plus every attached image in its original uploaded format,
// named after the fill's declared in-game source (image-db name / data id) so dropping the files
// onto the server lines up with the generated code. Nothing is transmitted -- all client-side.
function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'layout'
}
function extFor(mime: string): string {
  const m = /^image\/(\w+)/.exec(mime)
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png'
}
function download() {
  const base = safeFileName(currentLayoutName.value)
  const cs = generateFullClass(elements.value, provider.value, canvas.rootLayer, dataSources.value)
  const entries: ZipEntry[] = [{ name: `${base}.cs`, data: new TextEncoder().encode(cs) }]
  const seen = new Set<string>()
  for (const el of elements.value) {
    const img = el.type === 'panel' ? el.props.image : null
    if (!img || (img.kind !== 'png' && img.kind !== 'imagedb') || !img.previewImage || seen.has(img.previewImage)) continue
    seen.add(img.previewImage)
    const stored = getLocalImage(img.previewImage)
    if (!stored) continue
    const declared = img.kind === 'imagedb' ? img.dbName : img.png
    entries.push({ name: `${safeFileName(declared || stored.name.replace(/\.[^.]+$/, ''))}.${extFor(stored.type)}`, data: localImageBytes(stored) })
  }
  const zip = entries.length > 1
  const blob = zip ? buildZip(entries) : new Blob([entries[0].data], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = zip ? `${base}.zip` : `${base}.cs`
  a.click()
  URL.revokeObjectURL(a.href)
}

const copied = ref(false)
async function copy() {
  // Copy the CURRENT code, freshly generated — never the up-to-60ms-stale debounced snapshot mid-edit.
  // copyText falls back to execCommand when navigator.clipboard is unavailable (insecure context — e.g.
  // http on a LAN IP).
  if (await copyText(generateActive())) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1200)
  }
}
</script>

<template>
  <div class="ld-output">
    <Teleport :to="pipTarget" :disabled="!pipTarget">
      <div class="ld-out-inner">
        <div class="ld-out-head">
          <div class="ld-out-head-left">
            <div
              class="ld-out-target"
              role="group"
              aria-label="Target framework"
              :class="{ disabled: !targetApplies }"
              :title="targetApplies ? 'Target framework for the generated code' : 'Target applies to Class / UX / Selected'"
            >
              <button
                v-for="p in PROVIDERS"
                :key="p.value"
                type="button"
                :class="{ active: provider === p.value }"
                :disabled="!targetApplies"
                @click="provider = p.value"
              >
                {{ p.label }}
              </button>
            </div>
            <span class="ld-out-sep" aria-hidden="true" />
            <div class="ld-out-tabs" role="tablist">
              <button v-for="t in TABS" :key="t.id" :class="{ active: tab === t.id }" role="tab" @click="tab = t.id">{{ t.label }}</button>
            </div>
          </div>
          <div class="ld-out-actions">
            <button class="ld-out-copy" :title="copied ? 'Copied' : 'Copy'" @click="copy">
              <component :is="copied ? Check : Copy" :size="13" />
              {{ copied ? 'Copied' : 'Copy' }}
            </button>
            <button
              class="ld-out-copy"
              title="Download the generated plugin (.cs). Fills with a local preview image attached download as a zip: the .cs plus the images in their original format, named after their declared in-game source."
              @click="download"
            >
              <Download :size="13" />
            </button>
            <button
              v-if="popoutSupported"
              class="ld-out-copy ld-out-pop"
              :title="pipTarget ? 'Pop back in' : 'Pop out into its own window'"
              @click="togglePopout"
            >
              <component :is="pipTarget ? X : PictureInPicture2" :size="13" />
            </button>
            <button v-if="closePaneFn" class="ld-out-copy ld-out-pop" title="Close this pane (View to bring it back)" @click="closePaneFn('code')">
              <X :size="13" />
            </button>
          </div>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html — Shiki output is generated from our own code strings -->
        <div v-if="html" class="ld-shiki" v-html="html" />
        <pre v-else class="ld-out-body">{{ active }}</pre>
      </div>
    </Teleport>
    <div v-if="pipTarget" class="ld-out-placeholder">
      <span>Code panel popped out.</span>
      <button @click="closePopout"><X :size="12" /> Bring it back</button>
    </div>
  </div>
</template>

<style scoped>
.ld-output {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

/* the part that actually pops out (teleported into the PiP window); fills its host either way */
.ld-out-inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  height: 100%;
}

.ld-out-head-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ld-out-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* target framework as a segmented control (mirrors the toolbar's Aspect control) */
.ld-out-target {
  display: inline-flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  overflow: hidden;
}

.ld-out-target button {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  padding: 3px 10px;
  border-right: 1px solid var(--vp-c-divider);
}

.ld-out-target button:last-child {
  border-right: none;
}

.ld-out-target button:hover:not(.active):not(:disabled) {
  color: var(--vp-c-text-1);
}

.ld-out-target button.active {
  background: var(--c-carbon-1);
  color: #fff;
}

.ld-out-target.disabled {
  opacity: 0.4;
}

.ld-out-target.disabled button {
  cursor: not-allowed;
}

/* thin divider grouping the target apart from the view tabs */
.ld-out-sep {
  width: 1px;
  height: 18px;
  background: var(--vp-c-divider);
}

.ld-out-pop {
  padding: 2px 5px;
}

.ld-out-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.ld-out-placeholder button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  padding: 3px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
}

.ld-out-placeholder button:hover {
  color: var(--vp-c-text-1);
  border-color: var(--c-carbon-1);
}

.ld-out-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ld-out-tabs {
  display: inline-flex;
  gap: 2px;
}

.ld-out-tabs button {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-3);
  padding: 4px 10px;
  border-radius: 4px;
}

.ld-out-tabs button:hover {
  color: var(--vp-c-text-1);
}

.ld-out-tabs button.active {
  color: var(--c-carbon-1);
  background: var(--c-carbon-soft);
}

.ld-out-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--vp-c-text-3);
  padding: 2px 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
}

.ld-out-copy:hover {
  color: var(--vp-c-text-1);
  border-color: var(--c-carbon-1);
}

.ld-out-body {
  margin: 0;
  padding: 10px;
  /* flex:1 + min-height:0 so the <pre> scrolls internally instead of stretching its column
     (matters when the panel is a flex-sized side column, not the fixed-height bottom dock) */
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
  white-space: pre;
}

/* Shiki-highlighted output (v-html). The container scrolls; the injected <pre> carries the padding
   and matches the docs code-block background, with token colors from the theme. */
.ld-shiki {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.ld-shiki :deep(pre.shiki) {
  margin: 0;
  padding: 10px;
  background: var(--vp-code-block-bg, #161618) !important;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre;
}
</style>
