# AGENTS.md — dsh-diagram

English | [中文](#中文)

Machine-actionable notes for coding agents. Human documentation: [README.md](README.md) / [README.zh-CN.md](README.zh-CN.md).

## What this package is

A DSH bundle that adds four model-facing tools for turning HTML, a web page or an existing image into PNG and inlining it in the answer. It runs inside the DSH server process and drives the system Chrome/Edge over CDP; it has **zero npm dependencies** and **no dependency on any image plugin** such as `imgr`.

## Install

```sh
git clone https://github.com/LuosuQWQ/dsh-diagram.git
dsh plugin --profile <profile> add link:<absolute path>/dsh-diagram
# restart DSH; settings shows nothing extra, the tools are simply mounted
```

Requirements: DSH 0.2.x, Node 21+, Chrome/Edge/Chromium installed (set `DSH_DIAGRAM_BROWSER` when detection fails).

## Tools

- `diagram_render` — HTML fragment or full document → PNG; theme, width, scale, selector, output path.
- `page_screenshot` — `http(s)` URL, local HTML file or inline HTML; full page or one CSS selector.
- `image_annotate` — box / ellipse / arrow / line / text / highlight / blur, optional crop, percent coordinates.
- `diagram_guide` — theme variables, CSS classes and ready-made layouts for the HTML shell.

Every tool returns a `markdown` field: paste it as-is; the asset route serves the file. Files are also written to disk (default `.dsh/diagram/` under the session working directory).

## Post-install handoff (agents)

Tell the owner, in one short message: restart DSH, then the tools `diagram_render`, `page_screenshot`, `image_annotate` and `diagram_guide` are available; no settings page. Mention that images are rendered with the system Chrome/Edge and written to `.dsh/diagram/` by default.

## Constraints

- No npm dependencies; only Node built-ins and the browser's CDP pipe.
- Do not hardcode a browser path; use `DSH_DIAGRAM_BROWSER` or the probe list.
- Keep output portable: relative paths resolve against the session cwd.
- `npm test` is not provided; `node --check index.js lib/*.js` is the minimum gate.

---

<a id="中文"></a>

# AGENTS.md — dsh-diagram（中文）

给编码 agent 的机器可读说明。人类文档：[README.md](README.md) / [README.zh-CN.md](README.zh-CN.md)。

## 这个包是什么

一个 DSH bundle，挂载 4 个面向模型的工具：把 HTML、网页或已有图片渲染成 PNG，并内联进回答。它跑在 DSH 服务进程里，通过 CDP 驱动系统已装的 Chrome/Edge；**零 npm 依赖**，也**不依赖 imgr 之类的图片插件**。

## 安装

```sh
git clone https://github.com/LuosuQWQ/dsh-diagram.git
dsh plugin --profile <profile> add link:<本地绝对路径>/dsh-diagram
# 重启 DSH，工具即挂载
```

要求：DSH 0.2.x、Node 21+、机器上有 Chrome/Edge/Chromium（探测失败时设 `DSH_DIAGRAM_BROWSER`）。

## 工具

- `diagram_render`：HTML 片段/整页 → PNG，支持主题、宽度、倍数、选择器、输出路径；
- `page_screenshot`：URL / 本地 HTML / 内联 HTML，整页或单个 CSS 选择器；
- `image_annotate`：框、圈、箭头、线、文字、高亮、模糊打码，可先裁剪，坐标支持百分比；
- `diagram_guide`：主题变量、CSS 类与现成版式。

每个工具都返回 `markdown` 字段，原样贴进回复即可；文件同时落盘（默认会话工作目录下 `.dsh/diagram/`）。

## 安装后交接（给 agent）

用一句话告诉主人：重启 DSH 后即可使用 `diagram_render`、`page_screenshot`、`image_annotate`、`diagram_guide`，没有设置页；图片由系统 Chrome/Edge 渲染，默认写到 `.dsh/diagram/`。

## 约束

- 不引入 npm 依赖，只用 Node 内置模块和浏览器 CDP；
- 不写死浏览器路径，用 `DSH_DIAGRAM_BROWSER` 或探测列表；
- 输出保持可移植：相对路径按会话 cwd 解析；
- 没有 `npm test`；最低门槛是 `node --check index.js lib/*.js`。
