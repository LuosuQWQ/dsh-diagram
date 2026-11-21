# 图示渲染指南

## 先选工具

| 想做的事 | 工具 |
| --- | --- |
| 用自己的文字/框框/连线讲清流程、结构、对比、层级 | `diagram_render` |
| 把某个网页、或磁盘上已有的 HTML 报告截成图 | `page_screenshot` |
| 在已有截图/照片上圈重点、加箭头文字、打码 | `image_annotate` |

三步做完再回答：出图 → 把返回的 Markdown 原样放进回答 → 用一两句话说明图里该看什么。不要把同一张图重复贴两次。

## 画布与倍率

- `width` 默认 1200。信息密度高时用 1500；纵向长图也行，`height` 省略会按内容自动裁剪（推荐）。
- `scale` 默认 2，输出是画布尺寸的 2 倍像素，在聊天里更清晰。
- 画布宽度有限，别写 5 列以上并排卡片；超过 3 列就换行。

## 主题变量（片段里可直接用）

`--bg` 背景、`--panel` 卡片底、`--fg` 正文、`--muted` 次要文字、`--line` 描边、`--accent` 强调色、`--accent-soft` 强调底色、`--warn` / `--good` / `--bad` 状态色。

需要固定颜色时写 `var(--accent)`，不要硬编码 `#5b8cff`，否则 `theme: light` 下会看不清。

## 直接可用的类

`.doc` 页面内边距容器 · `h1` 大标题 · `.lead` 副标题 · `.grid` 横向弹性容器 · `.card` 卡片 · `.card h3` 卡片标题 · `.card p` 卡片正文 · `.card ul` 卡片列表 · `.arrow` 居中箭头 · `.pill` 胶囊标签 · `.accent` 强调文字 · `.dim` 次要文字 · `.mono` 等宽字体 · `table/th/td` 表格 · `code` 行内代码 · `.note` 脚注。

## 片段 1：三步流程

```html
<div class="grid">
  <div class="card"><h3>① 收集</h3><p>把散落的记录先归到一处。</p></div>
  <div class="arrow">→</div>
  <div class="card"><h3>② 归纳</h3><p>按主题合并，去掉重复项。</p></div>
  <div class="arrow">→</div>
  <div class="card"><h3>③ 输出</h3><p>一段结论加三条待办。</p></div>
</div>
```

## 片段 2：对比与清单

```html
<table>
  <tr><th>维度</th><th>方案 A</th><th>方案 B</th></tr>
  <tr><td>启动成本</td><td>低</td><td class="accent">中</td></tr>
  <tr><td>长期维护</td><td class="accent">简单</td><td>需要专人</td></tr>
</table>
<div class="grid" style="margin-top:18px">
  <div class="card"><h3>适合 A</h3><ul><li>先验证想法</li><li>两周内要上线</li></ul></div>
  <div class="card"><h3>适合 B</h3><ul><li>长期高频使用</li><li>有维护人手</li></ul></div>
</div>
```

## 片段 3：结构图（SVG 连线）

画布宽度可预测时，用固定坐标的 SVG 最省事：盒子和连线都在同一张 SVG 里，坐标以 1200 宽画布为准。

```html
<svg width="1120" height="260" style="display:block">
  <defs>
    <marker id="a" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="var(--accent)"></path>
    </marker>
  </defs>
  <rect x="0" y="40" width="220" height="90" rx="12" fill="var(--panel)" stroke="var(--line)"></rect>
  <text x="20" y="80" fill="var(--fg)" font-size="19">请求</text>
  <text x="20" y="108" fill="var(--muted)" font-size="14">用户输入</text>
  <line x1="228" y1="85" x2="318" y2="85" stroke="var(--accent)" stroke-width="3" marker-end="url(#a)"></line>
  <rect x="330" y="40" width="220" height="90" rx="12" fill="var(--panel)" stroke="var(--line)"></rect>
  <text x="350" y="80" fill="var(--fg)" font-size="19">处理</text>
  <text x="350" y="108" fill="var(--muted)" font-size="14">规则 + 模型</text>
</svg>
```

SVG 的 `font-family` 继承 body，中文字体不用另设。

## 标注（image_annotate）

```json
{ "type": "box", "x": 120, "y": 80, "width": 300, "height": 120, "label": "这里" }
```

坐标默认是原图像素。拿不准原图尺寸时用 `"unit": "percent"`，此时 x / width 是图片宽度的 0–1 比例，y / height 是高度的比例：`{ "type": "box", "x": 0.08, "y": 0.12, "width": 0.3, "height": 0.2 }` 就是左上角那一片。`crop` 始终按像素。

常用组合：

- 圈住一个小东西：`{ "type": "ellipse", "x": 0.42, "y": 0.36, "width": 0.08, "height": 0.06 }`
- 加箭头说明：`{ "type": "arrow", "x": 0.55, "y": 0.2, "x2": 0.72, "y2": 0.34, "label": "原因" }`
- 一段说明文字：`{ "type": "text", "x": 0.04, "y": 0.25, "text": "这一列是缓存命中率", "fontSize": 24 }`
- 打码：`{ "type": "blur", "x": 0.3, "y": 0.4, "width": 0.24, "height": 0.06 }`

同一张图上标注超过 5 处会糊，先裁剪（`crop`）再标。

## 常见坑

- 片段里别写 `<body>`、`<html>`、全局 `background`，那是外壳的事；只有给完整文档时（`<!doctype html>` 开头）才自己负责全部样式。
- 用 `flex` 布局时给卡片 `flex: 1 1 0`，否则宽度会塌。
- 文字别超过约 22 个字一行，38px 大标题 + 15.5px 正文是外壳默认的层级。
- 出图后先自己看一眼：把图片路径传给 `read_image`，确认没有文字溢出、没有重叠。
