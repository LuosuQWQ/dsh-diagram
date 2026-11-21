// Smoke test for the rendering pipeline, without the DSH runtime.
//   node plugins/dsh-diagram/test/smoke.mjs
// Writes PNGs into ./out and fails loudly on a broken render.

import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToPng, resolveBrowser } from '../lib/browser.js'
import { wrapDocument } from '../lib/shell.js'
import { annotateImage } from '../lib/annotate.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'out')
await mkdir(outDir, { recursive: true })

const results = []
function check(label, info, minBytes = 8000) {
  const size = info.bytes ?? 0
  if (size < minBytes) throw new Error(`${label}: 输出过小（${size} bytes），渲染可能失败`)
  results.push({ label, ...info })
  console.log(`ok  ${label}  ${info.width}×${info.height}px  ${(size / 1024).toFixed(0)} KiB  ${info.path}`)
}

console.log(`浏览器：${resolveBrowser()}`)

// 1. Diagram fragment, auto height, dark theme.
const flow = await renderToPng({
  source: {
    html: wrapDocument({
      theme: 'dark',
      title: '渲染链路',
      subtitle: '片段 → 外壳 → 无头浏览器 → PNG',
      html: `<div class="grid">
        <div class="card"><h3>① 片段</h3><p>只写内容块，样式交给外壳。</p></div>
        <div class="arrow">→</div>
        <div class="card"><h3>② 渲染</h3><p>固定宽度，高度按内容裁剪。</p></div>
        <div class="arrow">→</div>
        <div class="card"><h3>③ 内联</h3><p>返回 Markdown，聊天里直接出图。</p></div>
      </div>
      <p class="note">自动高度 · 2 倍图 · 中文字体</p>`,
    }),
  },
  width: 1200,
  scale: 2,
  outPath: path.join(outDir, 'flow.png'),
})
check('diagram auto-height', flow)

// 2. Full page screenshot of a local HTML file.
const reportFile = path.join(outDir, 'report.html')
await writeFile(
  reportFile,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    body{margin:0;font-family:"Microsoft YaHei",system-ui,sans-serif;background:#fff;color:#16203a}
    main{padding:36px 40px}
    h1{font-size:28px;margin:0 0 8px}
    p{color:#5b6b8c;margin:0 0 20px}
    table{border-collapse:collapse;width:100%;font-size:15px}
    th,td{border-bottom:1px solid #d7dfef;padding:9px 12px;text-align:left}
  </style></head><body><main>
    <h1>本地 HTML 截图</h1>
    <p>用来截已有报告，或先截图再标注。</p>
    <table><tr><th>项</th><th>值</th></tr>
    <tr><td>视口宽度</td><td>1000</td></tr><tr><td>倍率</td><td>2×</td></tr>
    <tr><td>整页</td><td>是</td></tr></table>
  </main></body></html>`,
  'utf8',
)
const page = await renderToPng({
  source: { file: reportFile },
  width: 1000,
  fullPage: true,
  scale: 2,
  outPath: path.join(outDir, 'page.png'),
})
check('page screenshot', page)

// 3. Annotate the screenshot: box, arrow, label, text, highlight, blur.
//    Percent units keep this test independent of the screenshot's pixel size.
const annotated = await annotateImage({
  imageFile: page.path,
  unit: 'percent',
  ops: [
    { type: 'box', x: 0.03, y: 0.16, width: 0.62, height: 0.1, label: '标题区', color: '#ff4d4f' },
    { type: 'ellipse', x: 0.04, y: 0.33, width: 0.24, height: 0.11, color: '#ffb020' },
    { type: 'arrow', x: 0.33, y: 0.2, x2: 0.45, y2: 0.3, label: '对应这一行' },
    { type: 'text', x: 0.48, y: 0.42, text: '这一列是数值', fontSize: 22, color: '#2f6bff' },
    { type: 'highlight', x: 0, y: 0, width: 1, height: 0.01, color: '#2f6bff' },
    { type: 'blur', x: 0.62, y: 0.62, width: 0.22, height: 0.07 },
  ],
  outPath: path.join(outDir, 'annotated.png'),
})
check('annotate', annotated)

// 4. Crop + annotate in one pass.
const cropped = await annotateImage({
  imageFile: page.path,
  crop: { x: 0, y: 60, width: 1000, height: 220 },
  ops: [{ type: 'box', x: 20, y: 20, width: 320, height: 70, label: '裁剪后仍在正确位置' }],
  outPath: path.join(outDir, 'cropped.png'),
})
check('crop + annotate', cropped)
if (cropped.height !== 440) throw new Error(`裁剪高度不对：期望 440（220×2），实际 ${cropped.height}`)

const total = (await Promise.all(results.map(item => stat(item.path)))).reduce((sum, item) => sum + item.size, 0)
console.log(`\n全部通过：${results.length} 张图，共 ${(total / 1024).toFixed(0)} KiB`)
