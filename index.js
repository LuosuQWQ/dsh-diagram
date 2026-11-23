// dsh-diagram: turn explanations into images.
//
// Three model-facing tools share one rendering pipeline (headless Chrome over
// CDP, see lib/browser.js):
//   diagram_render  HTML fragment/document -> explanatory PNG
//   page_screenshot http(s)/local page     -> PNG (full page or one element)
//   image_annotate  existing image         -> PNG with boxes/arrows/labels
// and a `diagram_guide` tool that hands over the style guide on demand.

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderToPng } from './lib/browser.js'
import { wrapDocument, normalizeTheme } from './lib/shell.js'
import { annotateImage } from './lib/annotate.js'

export const name = 'dsh-diagram'
export const inject = ['tools', 'webServer', 'systemPrompt']

const ROUTE = '/plugins/dsh-diagram/asset'
const OUTPUT_DIR = ['.dsh', 'diagram']
const MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
])

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sessionCwd(exec) {
  return exec?.agent?.session?.header?.cwd || process.cwd()
}

function clamp(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      out[key] = stripUndefined(item)
    }
    return out
  }
  return value
}

function slugify(text) {
  const slug = String(text ?? 'image')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'image'
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

function resolveOut(raw, cwd, seed) {
  if (raw) {
    const file = path.resolve(cwd, String(raw))
    mkdirSync(path.dirname(file), { recursive: true })
    return file
  }
  const dir = path.join(cwd, ...OUTPUT_DIR)
  mkdirSync(dir, { recursive: true })
  return path.join(dir, `${slugify(seed)}-${stamp()}.png`)
}

// 资源地址保持页面相对：Web 端页面本来就由本 Host 提供，桌面壳把
// `dsh-app://app/...` 转发到 Host 时会带上会话 cookie；写成绝对地址反而
// 会被浏览器当成跨站请求，连 cookie 都不会带上。相对地址两边都成立。
function assetMarkdown(file) {
  let version = '0'
  try { version = String(Math.round(statSync(file).mtimeMs)) } catch {}
  return `${ROUTE}?file=${encodeURIComponent(file)}&v=${version}`
}

function imageResult(info, alt) {
  const url = assetMarkdown(info.path)
  return stripUndefined({
    path: info.path,
    url,
    width: info.width,
    height: info.height,
    bytes: info.bytes,
    markdown: `![${alt}](<${url}>)`,
  })
}

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true }

function imageRender(_args, value) {
  if (!value?.markdown) return [{ type: 'text', text: `已保存：${value?.path ?? ''}` }]
  return [
    {
      type: 'text',
      text: `已生成 ${value.width}×${value.height} px 图片，文件：${value.path}\n把下面这一行原样放进回答（不要改写链接）：\n\n${value.markdown}`,
    },
  ]
}

/**
 * 向 Host 的 connection 服务要一次准入判断：Host/Origin 围栏 + 已认证的会话。
 * 没有这个服务（例如无 HTTP 层的组合）时不拦，保持插件可用。
 */
function requestRejection(ctx, req) {
  try {
    return ctx.get?.('connection')?.requestRejection?.(req)
  } catch {
    return undefined
  }
}

function serveAsset(ctx, req, res) {
  // 图片路由同样要过准入：否则用户浏览器里任意网页都能借这个端口探本机文件。
  const rejection = requestRejection(ctx, req)
  if (rejection !== undefined) {
    res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
    res.end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  try {
    const requestUrl = new URL(req.url ?? ROUTE, 'http://127.0.0.1')
    const file = requestUrl.searchParams.get('file')
    const contentType = MIME.get(path.extname(file ?? '').toLowerCase())
    if (!file || !contentType || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    const bytes = readFileSync(file)
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
    })
    if (req.method === 'HEAD') res.end()
    else res.end(bytes)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function diagramRenderTool(ctx) {
  return defineTool({
    name: 'diagram_render',
    description:
      '把一段 HTML 渲染成 PNG 并返回内联展示用的 Markdown：用图解释流程、结构、对比、层级或状态关系，比大段文字更快看懂。自带中文字体、深/浅主题和 .card/.grid/.arrow/.pill/table 等样式类；需要现成写法时先调 diagram_guide。',
    parameters: {
      html: {
        type: 'string',
        required: true,
        description:
          'HTML 片段（套上统一外壳，推荐）或完整 HTML 文档（以 <!doctype 或 <html 开头，原样渲染，负责自己的全部样式）。片段请把内容写成自适应的块级结构，不要给 body 设固定宽高。',
      },
      css: { type: 'string', description: '追加 CSS，可覆盖外壳主题变量与样式。' },
      title: { type: 'string', description: '大标题；仅片段模式生效。' },
      subtitle: { type: 'string', description: '标题下的一句话副标题。' },
      theme: { type: 'string', enum: ['dark', 'light'], description: '配色主题，默认 dark。' },
      width: { type: 'integer', description: '画布 CSS 宽度，默认 1200；信息密集时可用 1500。' },
      height: { type: 'integer', description: '画布 CSS 高度；省略则按内容自动裁剪（推荐）。' },
      scale: { type: 'number', description: '输出倍率 1–3，默认 2；2 倍图在聊天中更清晰。' },
      out: { type: 'string', description: '输出 PNG 路径（相对当前工作目录）；省略写入 .dsh/diagram/。' },
    },
    output: { schema: OUTPUT_SCHEMA, render: imageRender },
    execute: async (args, exec) => {
      const cwd = sessionCwd(exec)
      const html = wrapDocument({
        html: args.html,
        css: args.css,
        title: args.title,
        subtitle: args.subtitle,
        theme: normalizeTheme(args.theme),
      })
      const outPath = resolveOut(args.out, cwd, args.title ?? 'diagram')
      const info = await renderToPng({
        source: { html },
        width: Math.round(clamp(args.width, 1200, 240, 2400)),
        height: args.height === undefined ? undefined : Math.round(clamp(args.height, 800, 120, 4000)),
        scale: clamp(args.scale, 2, 1, 3),
        outPath,
      })
      return imageResult(info, args.title || '图示')
    },
  })
}

function pageScreenshotTool(ctx) {
  return defineTool({
    name: 'page_screenshot',
    description:
      '把网页或本地 HTML 文件截成 PNG：可截整页、或只截某个 CSS 选择器对应的元素。用于引用外部页面、渲染已有 HTML 报告，或先截图再用 image_annotate 标注。',
    parameters: {
      url: { type: 'string', description: '要截图的 http(s) 地址。' },
      file: { type: 'string', description: '本地 HTML 文件路径（相对当前工作目录或绝对路径）。' },
      html: { type: 'string', description: '直接给出 HTML 源码来截图。' },
      width: { type: 'integer', description: '视口宽度，默认 1440。' },
      height: { type: 'integer', description: '视口高度，默认 900；配合 fullPage 时作为最小高度。' },
      fullPage: { type: 'boolean', description: 'true 时截整页（含视口外内容），默认 false。' },
      selector: { type: 'string', description: '只截该 CSS 选择器命中的元素，优先于 fullPage。' },
      waitMs: { type: 'integer', description: '页面 load 后额外等待毫秒数，默认 400；异步渲染慢的页面可加大。' },
      scale: { type: 'number', description: '输出倍率 1–3，默认 2。' },
      out: { type: 'string', description: '输出 PNG 路径；省略写入 .dsh/diagram/。' },
    },
    output: { schema: OUTPUT_SCHEMA, render: imageRender },
    execute: async (args, exec) => {
      const cwd = sessionCwd(exec)
      const source = args.url ? { url: args.url } : args.file ? { file: path.resolve(cwd, args.file) } : args.html ? { html: args.html } : null
      if (!source) throw new Error('需要 url、file 或 html 之一')
      const outPath = resolveOut(args.out, cwd, 'screenshot')
      const info = await renderToPng({
        source,
        width: Math.round(clamp(args.width, 1440, 240, 3000)),
        height: args.fullPage ? undefined : Math.round(clamp(args.height, 900, 200, 3000)),
        fullPage: Boolean(args.fullPage),
        selector: args.selector || undefined,
        scale: clamp(args.scale, 2, 1, 3),
        maxHeight: 12000,
        outPath,
        afterLoad: async ({ wait }) => {
          const extra = clamp(args.waitMs, 400, 0, 8000)
          if (extra > 0) await wait(extra)
        },
      })
      return imageResult(info, '截图')
    },
  })
}

function imageAnnotateTool(ctx) {
  return defineTool({
    name: 'image_annotate',
    description:
      '在已有图片上画框、圈、箭头、文字、高亮或模糊区域，输出新的 PNG。用于指着截图/照片说"这里"、标出重点或打码。坐标是原图像素。',
    parameters: {
      image: { type: 'string', required: true, description: '要标注的图片路径（相对当前工作目录或绝对路径）。' },
      ops: {
        type: 'array',
        required: true,
        description: '标注操作，按顺序绘制。坐标单位为原图像素。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: {
              type: 'string',
              required: true,
              enum: ['box', 'ellipse', 'arrow', 'line', 'text', 'highlight', 'blur'],
              description:
                'box=矩形框；ellipse=椭圆圈；arrow=带箭头直线；line=直线；text=文字；highlight=半透明色块；blur=模糊打码。',
            },
            x: { type: 'number', description: '左上角 x；arrow/line 为起点 x；text 为文字左端 x。' },
            y: { type: 'number', description: '左上角 y；arrow/line 为起点 y；text 为文字基线 y。' },
            width: { type: 'number', description: 'box/ellipse/highlight/blur 的宽。' },
            height: { type: 'number', description: 'box/ellipse/highlight/blur 的高。' },
            x2: { type: 'number', description: 'arrow/line 终点 x。' },
            y2: { type: 'number', description: 'arrow/line 终点 y。' },
            text: { type: 'string', description: 'text 的正文。' },
            label: { type: 'string', description: 'box/ellipse/arrow 上的小标签，自带底色。' },
            color: { type: 'string', description: '颜色，默认 #ff4d4f。' },
            strokeWidth: { type: 'number', description: '线宽，默认 4。' },
            fontSize: { type: 'number', description: '字号，默认 20（label 默认 17）。' },
            opacity: { type: 'number', description: '整体不透明度 0–1。' },
            radius: { type: 'number', description: '矩形圆角，默认 8。' },
          },
        },
      },
      crop: {
        type: 'object',
        additionalProperties: false,
        description: '先裁剪原图再标注；坐标与宽高都是原图像素。',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
      unit: {
        type: 'string',
        enum: ['px', 'percent'],
        description:
          'ops 的坐标单位，默认 px（原图像素）。percent 时 x/width 用图片宽度的 0–1 比例、y/height 用高度的比例——不确定像素尺寸、只想"大致指这块区域"时用它。crop 始终是像素。',
      },
      scale: { type: 'number', description: '输出倍率 1–3，默认 2。' },
      out: { type: 'string', description: '输出 PNG 路径；省略写入 .dsh/diagram/。' },
    },
    output: { schema: OUTPUT_SCHEMA, render: imageRender },
    execute: async (args, exec) => {
      const cwd = sessionCwd(exec)
      const ops = Array.isArray(args.ops) ? args.ops : []
      if (!ops.length) throw new Error('ops 不能为空')
      const imageFile = path.resolve(cwd, String(args.image ?? ''))
      const outPath = resolveOut(args.out, cwd, `${path.parse(imageFile).name}-annotated`)
      const info = await annotateImage({
        imageFile,
        ops,
        crop: args.crop,
        unit: args.unit,
        scale: clamp(args.scale, 2, 1, 3),
        outPath,
      })
      return imageResult(info, path.basename(imageFile, path.extname(imageFile)))
    },
  })
}

function guideTool() {
  return defineTool({
    name: 'diagram_guide',
    description:
      '返回图示渲染的样式指南：主题变量、可用的 CSS 类、可直接套用的版式片段，以及标注/截图的常用组合。第一次画图或想要更好看时调用一次。',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => true,
    execute: async () => {
      const file = fileURLToPath(new URL('./guides/diagram.md', import.meta.url))
      const text = await readFile(file, 'utf8')
      return { text, path: file }
    },
  })
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

function promptSection() {
  return `需要讲清结构、流程、对比、层级或“这一点在截图里的哪里”时，用 diagram_render / page_screenshot / image_annotate 出图，而不是画 ASCII 示意图。图片会自动内联展示；不要把同一张图既放 Markdown 又调 show_image 重复一次。`
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler: (req, res) => serveAsset(ctx, req, res) }), 'dsh-diagram: image route')
  ctx.effect(() => ctx.tools.register(diagramRenderTool(ctx)), 'dsh-diagram: diagram_render')
  ctx.effect(() => ctx.tools.register(pageScreenshotTool(ctx)), 'dsh-diagram: page_screenshot')
  ctx.effect(() => ctx.tools.register(imageAnnotateTool(ctx)), 'dsh-diagram: image_annotate')
  ctx.effect(() => ctx.tools.register(guideTool()), 'dsh-diagram: diagram_guide')
  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'dsh-diagram', order: 186, text: () => promptSection() }),
    'dsh-diagram: prompt section',
  )
}
