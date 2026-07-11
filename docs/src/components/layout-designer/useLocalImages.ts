// Local preview images for image fills -- browsed from disk, kept ONLY in the browser's
// localStorage as data URLs. Nothing here is ever transmitted anywhere or emitted into generated
// code; the images exist so a stored-image fill (png data id / image-db name) can be SEEN while
// designing, and so "Download with images" can bundle the original bytes next to the .cs.
//
// localStorage is small (~5 MB shared with the layout store), so uploads are capped per image and
// in total, and gcLocalImages() drops entries no layout references anymore.
import { ref } from 'vue'
import { loadJson, saveJson } from './storage'

export interface LocalImage {
  /** Original bytes as a data URL (image/* only) -- format preserved exactly as uploaded. */
  dataUrl: string
  /** Original file name (used as the export fallback name). */
  name: string
  /** MIME type, e.g. image/png -- drives the export file extension. */
  type: string
}

const STORE_KEY = 'carbon-layout-designer:local-images'
/** Per-image cap on the encoded size. Base64 inflates ~4/3, so ~1.5 MB of storage = ~1.1 MB file. */
export const IMAGE_MAX_BYTES = 1_500_000
/** Budget for the whole image store -- leaves the rest of the ~5 MB quota to the layout store. */
export const IMAGES_TOTAL_BYTES = 3_500_000

const images = ref<Record<string, LocalImage>>(loadJson(STORE_KEY, {}))

function persistImages(): boolean {
  saveJson(STORE_KEY, images.value)
  return true
}

function storeSize(store: Record<string, LocalImage>): number {
  let n = 0
  for (const k in store) n += store[k].dataUrl.length
  return n
}

let imageSeq = 0
function newImageId(): string {
  return `img-${Date.now()}-${++imageSeq}`
}

/**
 * Read a browsed file into the store. Resolves to the new image id, or throws with a
 * user-presentable message (not an image / too big / store full).
 */
async function putImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be used as a preview.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read the file.'))
    r.readAsDataURL(file)
  })
  if (dataUrl.length > IMAGE_MAX_BYTES) throw new Error('Image too large for the preview store (roughly a 1 MB file at most). Downscale it first.')
  if (storeSize(images.value) + dataUrl.length > IMAGES_TOTAL_BYTES) throw new Error('The preview image store is full. Remove preview images from other fills (or delete unused layouts) first.')
  const id = newImageId()
  images.value = { ...images.value, [id]: { dataUrl, name: file.name, type: file.type || 'image/png' } }
  persistImages()
  return id
}

function getLocalImage(id: string | undefined | null): LocalImage | null {
  return (id && images.value[id]) || null
}

/** Drop every stored image whose id is not in `referenced` (call with ids from ALL layouts). */
function gcLocalImages(referenced: Set<string>) {
  let changed = false
  const next: Record<string, LocalImage> = {}
  for (const [id, img] of Object.entries(images.value)) {
    if (referenced.has(id)) next[id] = img
    else changed = true
  }
  if (changed) {
    images.value = next
    persistImages()
  }
}

/** Every `previewImage` id referenced anywhere in the given values (layout datas, live elements...).
 *  A JSON scan keeps this immune to element-shape changes. */
export function collectPreviewImageIds(...roots: unknown[]): Set<string> {
  const out = new Set<string>()
  for (const root of roots) {
    const json = JSON.stringify(root) ?? ''
    for (const m of json.matchAll(/"previewImage":"([^"]+)"/g)) out.add(m[1])
  }
  return out
}

/** Decode a stored data URL back to raw bytes (for the zip export -- original format, no re-encode). */
export function localImageBytes(img: LocalImage): Uint8Array {
  const b64 = img.dataUrl.slice(img.dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function useLocalImages() {
  return { images, putImageFile, getLocalImage, gcLocalImages }
}
