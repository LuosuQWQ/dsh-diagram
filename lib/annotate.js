// Builds the page that draws annotation operations on top of an existing
// image: boxes, ellipses, arrows, labels, highlights and blur redaction.
//
// Coordinates in `ops` are pixels of the source image, origin at its top-left.

import { existsSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { escapeHtml } from './shell.js'
import { renderToPng } from './browser.js'

const DEFAULT_COLOR = '#ff4d4f'

function num(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function pickBox(op) {
  const x = num(op.x, 0)
  const y = num(op.y, 0)
  const width = num(op.width ?? op.w, 0)
  const height = num(op.height ?? op.h, 0)
  return { x, y, width, height }
}

/** Rough text width in px: CJK glyphs are ~1em, latin ~0.58em. */
function estimateTextWidth(text, fontSize) {
  let units = 0
  for (const char of String(text)) {
    units += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(char) ? 1 : 0.58
  }
  return units * fontSize
}

export function annotateDocument(imageHref) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; padding: 0; }
#stage { position: relative; overflow: hidden; line-height: 0; }
#base { display: block; max-width: none; }
#ov { position: absolute; left: 0; top: 0; }
#ov svg { position: absolute; left: 0; top: 0; overflow: visible; }
.blur { position: absolute; overflow: hidden; }
.blur i { position: absolute; display: block; filter: blur(9px) saturate(0.75); }
</style>
</head>
<body>
<div id="stage"><img id="base" src="${escapeHtml(imageHref)}" alt=""><div id="ov"></div></div>
</body>
</html>`
}

export function overlayMarkup({ naturalWidth, naturalHeight, crop, ops, imageHref }) {
  const blocks = []
  const markers = []
  const markerIdByColor = new Map()

  const markerFor = color => {
    if (markerIdByColor.has(color)) return markerIdByColor.get(color)
    const id = `arrow-${markerIdByColor.size}`
    markerIdByColor.set(color, id)
    markers.push(
      `<marker id="${id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">` +
        `<path d="M0,0 L10,4 L0,8 Z" fill="${escapeHtml(color)}"></path></marker>`,
    )
    return id
  }

  const label = (text, x, y, color, fontSize) => {
    if (!text) return ''
    const width = estimateTextWidth(text, fontSize) + 14
    const height = fontSize * 1.5
    const left = Math.round(x)
    const top = Math.round(y - height - 6)
    return (
      `<g><rect x="${left}" y="${top}" rx="7" width="${Math.round(width)}" height="${Math.round(height)}" ` +
      `fill="${escapeHtml(color)}" opacity="0.92"></rect>` +
      `<text x="${Math.round(left + 7)}" y="${Math.round(top + height * 0.72)}" font-size="${fontSize}" ` +
      `fill="#ffffff" font-weight="600" font-family="system-ui, sans-serif">${escapeHtml(text)}</text></g>`
    )
  }

  for (const op of ops) {
    const type = String(op.type ?? 'box').toLowerCase()
    const color = String(op.color ?? DEFAULT_COLOR)
    const strokeWidth = num(op.strokeWidth, 4)
    const fontSize = num(op.fontSize, 20)
    const opacity = num(op.opacity, 1)

    if (type === 'blur') {
      const { x, y, width, height } = pickBox(op)
      blocks.push(
        `<div class="blur" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px">` +
          `<i style="left:${-x}px;top:${-y}px;width:${naturalWidth}px;height:${naturalHeight}px;` +
          `background-image:url('${escapeHtml(imageHref)}');background-size:${naturalWidth}px ${naturalHeight}px"></i></div>`,
      )
      continue
    }

    if (type === 'text') {
      const x = num(op.x, 0)
      const y = num(op.y, 0)
      const text = String(op.text ?? '')
      // A soft dark halo keeps the label readable on both light and dark
      // screenshots without looking like a white outline.
      const halo = op.halo === 'none' ? 'none' : String(op.halo ?? 'rgba(0,0,0,0.45)')
      const haloWidth = halo === 'none' ? 0 : num(op.haloWidth, 3)
      blocks.push(
        `<text x="${x}" y="${y}" font-size="${fontSize}" font-weight="${op.bold === false ? 400 : 650}" ` +
          `fill="${escapeHtml(color)}" stroke="${escapeHtml(halo)}" stroke-width="${haloWidth}" ` +
          `paint-order="stroke" font-family="system-ui, sans-serif">${escapeHtml(text)}</text>`,
      )
      continue
    }

    if (type === 'arrow' || type === 'line') {
      const x = num(op.x, 0)
      const y = num(op.y, 0)
      const x2 = num(op.x2, x)
      const y2 = num(op.y2, y)
      const marker = type === 'arrow' ? ` marker-end="url(#${markerFor(color)})"` : ''
      blocks.push(
        `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${escapeHtml(color)}" ` +
          `stroke-width="${strokeWidth}" stroke-linecap="round"${marker}></line>`,
      )
      if (op.label) blocks.push(label(String(op.label), (x + x2) / 2, (y + y2) / 2, color, num(op.fontSize, 17)))
      continue
    }

    const { x, y, width, height } = pickBox(op)
    const rx = num(op.radius, 8)

    if (type === 'highlight') {
      blocks.push(
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ` +
          `fill="${escapeHtml(color)}" opacity="${num(op.opacity, 0.22)}"></rect>`,
      )
      continue
    }

    if (type === 'ellipse' || type === 'circle') {
      blocks.push(
        `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${Math.abs(width / 2)}" ry="${Math.abs(height / 2)}" ` +
          `fill="${op.filled ? escapeHtml(color) : 'none'}" fill-opacity="${num(op.fillOpacity, 0.16)}" ` +
          `stroke="${escapeHtml(color)}" stroke-width="${strokeWidth}" opacity="${opacity}"></ellipse>`,
      )
      if (op.label) blocks.push(label(String(op.label), x, y, color, num(op.fontSize, 17)))
      continue
    }

    // box
    blocks.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ` +
        `fill="${op.fill ? escapeHtml(String(op.fill)) : 'none'}" ` +
        `stroke="${escapeHtml(color)}" stroke-width="${strokeWidth}" opacity="${opacity}"></rect>`,
    )
    if (op.label) blocks.push(label(String(op.label), x, y, color, num(op.fontSize, 17)))
  }

  // Crop is applied by shifting the overlay, so op coordinates stay in source
  // image pixels.
  return (
    `<div style="position:absolute;left:${-crop.x}px;top:${-crop.y}px">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${naturalWidth}" height="${naturalHeight}">` +
    (markers.length ? `<defs>${markers.join('')}</defs>` : '') +
    blocks.join('') +
    `</svg></div>`
  )
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** `unit: 'percent'` operators are fractions of the image width/height. */
function scaleOps(ops, unit, imageWidth, imageHeight) {
  if (String(unit ?? 'px').toLowerCase() !== 'percent') return ops
  const nx = value => (value === undefined ? undefined : num(value, 0) * imageWidth)
  const ny = value => (value === undefined ? undefined : num(value, 0) * imageHeight)
  return ops.map(op => ({
    ...op,
    x: nx(op.x),
    y: ny(op.y),
    x2: nx(op.x2),
    y2: ny(op.y2),
    width: nx(op.width ?? op.w),
    height: ny(op.height ?? op.h),
  }))
}

/**
 * Render `ops` onto an existing image file and write the result to `outPath`.
 * Returns the same shape as renderToPng plus the crop that was actually used.
 */
export async function annotateImage({ imageFile, ops, crop, unit = 'px', scale = 2, outPath, maxHeight = 12000 }) {
  const file = String(imageFile)
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`图片不存在：${file}`)
  const imageHref = pathToFileURL(file).href
  let appliedCrop = { x: 0, y: 0, width: 0, height: 0 }

  const info = await renderToPng({
    source: { html: annotateDocument(imageHref) },
    width: 1200,
    scale: clampNumber(scale, 2, 1, 3),
    maxHeight,
    outPath,
    afterLoad: async ({ evaluate, setViewport, wait }) => {
      const size = await evaluate(
        `(() => { const i = document.getElementById('base'); return { w: i.naturalWidth, h: i.naturalHeight } })()`,
      )
      const naturalWidth = Number(size?.w)
      const naturalHeight = Number(size?.h)
      if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
        throw new Error('读不到图片尺寸，请确认文件是有效的 PNG/JPEG/WebP 图片')
      }

      const cropX = Math.round(clampNumber(crop?.x, 0, 0, naturalWidth - 1))
      const cropY = Math.round(clampNumber(crop?.y, 0, 0, naturalHeight - 1))
      const cropWidth = Math.round(clampNumber(crop?.width, naturalWidth - cropX, 1, naturalWidth - cropX))
      const cropHeight = Math.round(clampNumber(crop?.height, naturalHeight - cropY, 1, naturalHeight - cropY))
      appliedCrop = { x: cropX, y: cropY, width: cropWidth, height: cropHeight }

      await setViewport(cropWidth, cropHeight)
      await evaluate(`(() => {
        const stage = document.getElementById('stage')
        const base = document.getElementById('base')
        stage.style.width = '${cropWidth}px'
        stage.style.height = '${cropHeight}px'
        base.style.width = '${naturalWidth}px'
        base.style.height = '${naturalHeight}px'
        base.style.marginLeft = '${-cropX}px'
        base.style.marginTop = '${-cropY}px'
        return true
      })()`)

      const overlay = overlayMarkup({
        naturalWidth,
        naturalHeight,
        crop: appliedCrop,
        ops: scaleOps(ops, unit, naturalWidth, naturalHeight),
        imageHref,
      })
      await evaluate(`(() => { document.getElementById('ov').innerHTML = ${JSON.stringify(overlay)}; return true })()`)
      await wait(160)
      return { height: cropHeight }
    },
  })

  return { ...info, crop: appliedCrop }
}
