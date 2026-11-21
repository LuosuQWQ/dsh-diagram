// Page shell shared by every render: fonts, theme tokens, and a small set of
// utility classes the model can rely on when writing an HTML fragment.

const FONT_STACK =
  '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Segoe UI", system-ui, -apple-system, sans-serif'
const MONO_STACK = '"Cascadia Mono", "Consolas", "SFMono-Regular", "Menlo", "DejaVu Sans Mono", monospace'

export const THEMES = {
  dark: {
    bg: '#0e1320',
    panel: '#151d31',
    fg: '#e9eefb',
    muted: '#94a5c3',
    line: '#2a3654',
    accent: '#5b8cff',
    accentSoft: 'rgba(91, 140, 255, 0.14)',
    warn: '#ffb020',
    good: '#3ecf8e',
    bad: '#ff6b6b',
  },
  light: {
    bg: '#ffffff',
    panel: '#f5f7fb',
    fg: '#16203a',
    muted: '#5b6b8c',
    line: '#d7dfef',
    accent: '#2f6bff',
    accentSoft: 'rgba(47, 107, 255, 0.10)',
    warn: '#b45309',
    good: '#0f9d68',
    bad: '#d92d20',
  },
}

export function normalizeTheme(theme) {
  return THEMES[String(theme ?? 'dark').toLowerCase()] ? String(theme).toLowerCase() : 'dark'
}

export function themeVars(themeName) {
  const theme = THEMES[normalizeTheme(themeName)]
  return Object.entries(theme)
    .map(([key, value]) => `  --${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${value};`)
    .join('\n')
}

function baseCss(themeName) {
  return `:root {
${themeVars(themeName)}
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: ${FONT_STACK};
  font-size: 18px;
  line-height: 1.62;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.doc { padding: 46px 50px; }
h1 { font-size: 34px; line-height: 1.28; margin: 0 0 10px; font-weight: 700; letter-spacing: 0.2px; }
h2 { font-size: 24px; line-height: 1.35; margin: 30px 0 12px; font-weight: 650; }
.lead { color: var(--muted); font-size: 17px; margin: 0 0 30px; }
.grid { display: flex; gap: 16px; flex-wrap: wrap; align-items: stretch; }
.grid > .card { flex: 1 1 0; }
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px;
  min-width: 0;
}
.card > h3, .card > h4 { margin: 0 0 8px; font-size: 19px; font-weight: 640; }
.card > p { margin: 0; color: var(--muted); font-size: 15.5px; line-height: 1.66; }
.card > ul, .card > ol { margin: 8px 0 0; padding-left: 18px; color: var(--muted); font-size: 15px; }
.card li + li { margin-top: 4px; }
.arrow { display: flex; align-items: center; justify-content: center; color: var(--accent); font-size: 26px; flex: 0 0 auto; }
.pill {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13.5px;
  color: var(--muted);
  margin: 0 8px 8px 0;
}
.accent { color: var(--accent); }
.dim { color: var(--muted); }
.mono { font-family: ${MONO_STACK}; font-size: 14.5px; }
.note { margin-top: 26px; color: var(--muted); font-size: 14px; }
table { width: 100%; border-collapse: collapse; font-size: 15.5px; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 14px; }
tr:last-child td { border-bottom: none; }
code { font-family: ${MONO_STACK}; font-size: 14.5px; background: var(--accentSoft); padding: 1px 6px; border-radius: 6px; }`
}

const FULL_DOCUMENT = /^\s*(?:<!doctype\s+html|<html[\s>])/i

export function isFullDocument(html) {
  return FULL_DOCUMENT.test(String(html ?? ''))
}

/**
 * Wrap an HTML fragment in the diagram shell, or pass a complete document
 * through while still appending extra CSS.
 */
export function wrapDocument({ html, css, title, subtitle, theme }) {
  const themeName = normalizeTheme(theme)
  const body = String(html ?? '')
  if (isFullDocument(body)) {
    if (!css) return body
    const style = `<style>\n${css}\n</style>`
    return /<\/head>/i.test(body) ? body.replace(/<\/head>/i, `${style}\n</head>`) : `${style}\n${body}`
  }
  const header = [
    title ? `<h1>${escapeHtml(title)}</h1>` : '',
    subtitle ? `<p class="lead">${escapeHtml(subtitle)}</p>` : '',
  ].join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
${baseCss(themeName)}
${css ?? ''}
</style>
</head>
<body>
<div class="doc">${header}${body}</div>
</body>
</html>`
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
