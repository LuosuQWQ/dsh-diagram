// End-to-end test of the tool layer without the DSH runtime: registers the
// plugin against a stub ctx, calls every tool, then serves the returned
// Markdown URL through the plugin's own route handler and checks the bytes.
//
//   node plugins/dsh-diagram/test/tool-path.mjs

import { readFile, mkdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'out')
await mkdir(outDir, { recursive: true })

// --- stub ctx ---------------------------------------------------------------
const tools = new Map()
const routes = []
const sections = []
let origin = ''
const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  tools: { register: tool => tools.set(tool.name, tool) },
  webServer: {
    register: route => {
      routes.push(route)
      return () => {}
    },
    getOrigin: () => origin,
    port: 0,
  },
  systemPrompt: { section: section => sections.push(section) },
}

apply(ctx)
console.log(`注册工具：${[...tools.keys()].join('、')}`)
console.log(`注册路由：${routes.map(route => route.path).join('、')}`)
console.log(`提示段落：${sections.map(section => section.name).join('、')}`)
for (const expected of ['diagram_render', 'page_screenshot', 'image_annotate', 'diagram_guide']) {
  if (!tools.has(expected)) throw new Error(`缺少工具：${expected}`)
}

// --- serve the plugin route on a real port ---------------------------------
const server = createServer((req, res) => {
  const route = routes.find(item => (req.url ?? '').startsWith(item.path))
  if (!route) {
    res.writeHead(404)
    res.end()
    return
  }
  route.handler(req, res)
})
await new Promise((resolve, reject) => server.listen(18787, '127.0.0.1', resolve).on('error', reject))
origin = `http://127.0.0.1:${server.address().port}`

const results = []
async function fetchMarkdown(label, value, minBytes = 8000) {
  if (!value?.markdown) throw new Error(`${label}: 没有返回 markdown`)
  const url = value.markdown.match(/\(<(.+)>\)/)?.[1]
  if (!url || !url.startsWith(origin)) throw new Error(`${label}: markdown 链接异常 ${value.markdown}`)
  const response = await fetch(url)
  if (response.status !== 200) throw new Error(`${label}: 路由返回 ${response.status}`)
  if (response.headers.get('content-type') !== 'image/png') throw new Error(`${label}: content-type 不是 PNG`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${label}: 不是合法 PNG`)
  if (bytes.length < minBytes) throw new Error(`${label}: 图片过小 ${bytes.length} bytes`)
  const onDisk = await stat(value.path)
  if (onDisk.size !== bytes.length) throw new Error(`${label}: 路由内容与落盘文件不一致`)
  results.push({ label, path: value.path, width: value.width, height: value.height, bytes: bytes.length })
  console.log(`ok  ${label}  ${value.width}×${value.height}px  ${(bytes.length / 1024).toFixed(0)} KiB  ${value.path}`)
}

const exec = { agent: { session: { header: { cwd: outDir } } } }

// 1. diagram_render — the real shape of an explanatory picture.
const diagram = await tools.get('diagram_render').execute(
  {
    title: 'dsh-diagram · 把话变成图',
    subtitle: 'HTML / 网页 / 已有图片 → PNG → 内联到回答里',
    theme: 'dark',
    width: 1280,
    out: 'demo-flow.png',
    html: `<div class="grid">
      <div class="card" style="flex:1 1 0"><h3>① diagram_render</h3><p>写一段 HTML，套上统一外壳：中文字体、深浅主题、卡片与箭头样式现成可用。</p><p class="mono" style="margin-top:10px;color:var(--accent)">流程图 · 对比表 · 结构图</p></div>
      <div class="card" style="flex:1 1 0"><h3>② page_screenshot</h3><p>把网页或本地 HTML 截成图：可整页，也可只截某个选择器命中的元素。</p><p class="mono" style="margin-top:10px;color:var(--accent)">url · file · html</p></div>
      <div class="card" style="flex:1 1 0"><h3>③ image_annotate</h3><p>在已有截图上画框、圈、箭头、文字、高亮、模糊打码；坐标可用像素或百分比。</p><p class="mono" style="margin-top:10px;color:var(--accent)">box · arrow · text · blur</p></div>
    </div>
    <div style="margin-top:28px">
      <span class="pill">Edge / Chrome 无头渲染</span>
      <span class="pill">CDP 管道直连，零依赖</span>
      <span class="pill">2× 高清输出</span>
      <span class="pill">自动内联 Markdown</span>
    </div>`,
  },
  exec,
)
await fetchMarkdown('diagram_render', diagram)

// 2. page_screenshot — capture a local HTML report, full page.
const shot = await tools.get('page_screenshot').execute(
  {
    width: 900,
    fullPage: true,
    out: 'demo-shot.png',
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      body{margin:0;font-family:"Microsoft YaHei",system-ui,sans-serif;background:#fff;color:#16203a}
      main{padding:32px 36px}
      h1{font-size:26px;margin:0 0 6px}
      p{color:#5b6b8c;margin:0 0 18px}
      table{border-collapse:collapse;width:100%;font-size:15px}
      th,td{border-bottom:1px solid #d7dfef;padding:9px 12px;text-align:left}
    </style></head><body><main>
      <h1>本地 HTML 截图</h1>
      <p>先落盘、再截图，然后交给 image_annotate 标注。</p>
      <table><tr><th>工具</th><th>输入</th></tr>
      <tr><td>diagram_render</td><td>HTML 片段</td></tr>
      <tr><td>page_screenshot</td><td>url / file / html</td></tr>
      <tr><td>image_annotate</td><td>已有图片 + ops</td></tr></table>
    </main></body></html>`,
  },
  exec,
)
await fetchMarkdown('page_screenshot', shot)

// 3. image_annotate — percent units, so it does not depend on pixel sizes.
const annotated = await tools.get('image_annotate').execute(
  {
    image: diagram.path,
    unit: 'percent',
    scale: 1,
    out: 'demo-annotated.png',
    ops: [
      { type: 'box', x: 0.02, y: 0.1, width: 0.3, height: 0.52, label: '这里', color: '#ff4d4f' },
      { type: 'arrow', x: 0.33, y: 0.18, x2: 0.47, y2: 0.36, label: '指向第二张卡' },
      { type: 'text', x: 0.52, y: 0.66, text: '百分比坐标无需知道像素', fontSize: 26, color: '#2f6bff' },
    ],
  },
  exec,
)
await fetchMarkdown('image_annotate', annotated)

// 4. diagram_guide — bounded text, no image.
const guide = await tools.get('diagram_guide').execute({}, exec)
if (!guide?.text?.includes('主题变量')) throw new Error('diagram_guide 返回内容异常')
console.log(`ok  diagram_guide  ${guide.text.length} 字符`)

server.close()

const thumbs = await Promise.all(results.map(item => readFile(item.path)))
console.log(`\n全部通过：${results.length} 张图 + 1 份指南，共 ${(thumbs.reduce((sum, b) => sum + b.length, 0) / 1024).toFixed(0)} KiB`)
