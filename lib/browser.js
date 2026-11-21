// HTML -> PNG rendering engine for dsh-diagram.
//
// Drives the Chrome/Edge already installed on the machine over the DevTools
// protocol, using `--remote-debugging-pipe` (fd 3 in, fd 4 out) instead of a
// TCP port. The pipe keeps the engine local and immune to HTTP proxy env vars,
// which otherwise capture localhost WebSocket connections. No npm dependency,
// no bundled browser.
//
// Public API: renderToPng({ source, ... }) -> { path, bytes, width, height }

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const MAC_LINUX_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
]

function browserCandidates() {
  const found = []
  const env = process.env
  if (env.DSH_DIAGRAM_BROWSER) found.push(env.DSH_DIAGRAM_BROWSER)
  if (process.platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env['ProgramFiles'], env['LOCALAPPDATA']].filter(Boolean)
    for (const root of roots) {
      found.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      found.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
  }
  return found.concat(MAC_LINUX_CANDIDATES)
}

export function resolveBrowser() {
  for (const candidate of browserCandidates()) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {}
  }
  throw new Error(
    '未找到 Chrome/Edge。请安装其一，或把环境变量 DSH_DIAGRAM_BROWSER 设为浏览器可执行文件路径。',
  )
}

async function stopBrowser(child, dir) {
  if (child && child.pid && !child.killed) {
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        killer.on('close', resolve)
        killer.on('error', resolve)
      })
    } else {
      try { child.kill('SIGKILL') } catch {}
    }
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch {
      await sleep(150)
    }
  }
}

function launch(browser, extraArgs = []) {
  const dirPromise = mkdtemp(path.join(tmpdir(), 'dsh-diagram-'))
  return dirPromise.then(dir => {
    const args = [
      '--headless=new',
      '--remote-debugging-pipe',
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-sync',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--force-color-profile=srgb',
      ...extraArgs,
      'about:blank',
    ]
    // fd 3: we write commands. fd 4: we read responses and events.
    const child = spawn(browser, args, {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return { child, dir }
  })
}

/** JSON messages over a pair of pipes, NUL separated. */
class PipeCdp {
  constructor(child) {
    this.child = child
    this.nextId = 0
    this.pending = new Map()
    this.waiters = new Map()
    this.sessionId = undefined
    this.buffer = ''
    this.closed = false
    this.writer = child.stdio[3]
    this.reader = child.stdio[4]
    this.reader.setEncoding('utf8')
    this.reader.on('data', chunk => this.ingest(chunk))
    this.reader.on('error', () => { this.closed = true })
    child.on('exit', () => { this.closed = true })
  }

  ingest(chunk) {
    this.buffer += chunk
    let index = this.buffer.indexOf('\u0000')
    while (index !== -1) {
      const raw = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (raw) {
        try { this.dispatch(JSON.parse(raw)) } catch {}
      }
      index = this.buffer.indexOf('\u0000')
    }
  }

  dispatch(message) {
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`))
      else entry.resolve(message.result)
      return
    }
    if (!message.method) return
    const key = message.sessionId ? `${message.method}@${message.sessionId}` : message.method
    const waiting = this.waiters.get(key)
    if (waiting && waiting.length) {
      this.waiters.delete(key)
      for (const resolve of waiting) resolve(message.params)
    }
    const general = this.waiters.get(message.method)
    if (general && general.length && message.sessionId) {
      // An event with a session also satisfies a command-level waiter that was
      // registered without a session filter.
      this.waiters.delete(message.method)
      for (const resolve of general) resolve(message.params)
    }
  }

  write(message) {
    if (this.closed) throw new Error('浏览器进程已退出')
    this.writer.write(`${JSON.stringify(message)}\u0000`)
  }

  raw(method, params = {}, options = {}) {
    const id = (this.nextId += 1)
    const payload = { id, method, params }
    if (options.sessionId) payload.sessionId = options.sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.write(payload)
      } catch (error) {
        this.pending.delete(id)
        reject(error)
        return
      }
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`浏览器无响应：${method}`))
      }, options.timeoutMs ?? 45000)
    })
  }

  /** Command on the attached page session. */
  send(method, params = {}) {
    return this.raw(method, params, { sessionId: this.sessionId })
  }

  once(method, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const key = this.sessionId ? `${method}@${this.sessionId}` : method
      const list = this.waiters.get(key) ?? []
      list.push(resolve)
      this.waiters.set(key, list)
      setTimeout(() => reject(new Error(`等待事件超时：${method}`)), timeoutMs)
    })
  }

  async attachToPage() {
    const targets = await this.raw('Target.getTargets')
    const page = (targets.targetInfos ?? []).find(
      target => target.type === 'page' && !String(target.url ?? '').startsWith('devtools://'),
    )
    let targetId = page?.targetId
    if (!targetId) {
      const created = await this.raw('Target.createTarget', { url: 'about:blank' })
      targetId = created.targetId
      await sleep(120)
    }
    const attached = await this.raw('Target.attachToTarget', { targetId, flatten: true })
    this.sessionId = attached.sessionId
    return targetId
  }

  close() {
    this.closed = true
    try { this.writer.end() } catch {}
    try { this.reader.destroy() } catch {}
  }
}

function pageFileUrl(source, dir) {
  if (source.url) return { url: String(source.url) }
  if (source.file) {
    const file = path.resolve(String(source.file))
    if (!existsSync(file)) throw new Error(`文件不存在：${file}`)
    return { url: pathToFileURL(file).href }
  }
  if (source.html !== undefined && source.html !== null) {
    return { html: String(source.html) }
  }
  throw new Error('需要提供 html、file 或 url 之一')
}

/**
 * Render a page to PNG.
 *
 * source: { html } | { file } | { url }
 * height: omit to crop to content height
 * afterLoad({ evaluate, setViewport, wait }): optional hook; may mutate the page
 *   and resize the viewport, and may return { height } to pin the clip height.
 */
export async function renderToPng({
  source,
  width = 1200,
  height,
  scale = 2,
  fullPage = false,
  selector,
  maxHeight = 8000,
  outPath,
  afterLoad,
  timeoutMs = 45000,
}) {
  const browser = resolveBrowser()
  const session = await launch(browser)
  let cdp
  try {
    cdp = new PipeCdp(session.child)
    try {
      await cdp.attachToPage()
    } catch (error) {
      throw new Error(`无法连接浏览器调试管道：${error instanceof Error ? error.message : String(error)}`)
    }

    const target = pageFileUrl(source, session.dir)
    if (target.html !== undefined) {
      const file = path.join(session.dir, 'page.html')
      await writeFile(file, target.html, 'utf8')
      target.url = pathToFileURL(file).href
    }

    const evaluate = async (expression, options = {}) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: Boolean(options.awaitPromise),
      })
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.text || result.exceptionDetails.exception?.description || '页面脚本执行失败',
        )
      }
      return result.result?.value
    }

    let viewportWidth = Math.round(width)
    let viewportHeight = Math.round(height ?? Math.min(1400, maxHeight))
    const setViewport = (nextWidth, nextHeight) => {
      viewportWidth = Math.round(nextWidth)
      viewportHeight = Math.round(nextHeight)
      return cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewportWidth,
        height: viewportHeight,
        deviceScaleFactor: scale,
        mobile: false,
      })
    }

    await cdp.send('Page.enable')
    await setViewport(width, viewportHeight)

    const loaded = cdp.once('Page.loadEventFired', timeoutMs)
    await cdp.send('Page.navigate', { url: target.url })
    await loaded
    await evaluate('document.fonts.ready.then(() => true)', { awaitPromise: true })
    await sleep(80)

    let forcedHeight
    if (afterLoad) {
      const override = await afterLoad({ evaluate, setViewport, cdp, wait: sleep })
      const declared = Number(override?.height)
      if (Number.isFinite(declared) && declared > 0) forcedHeight = Math.round(declared)
    }

    let clip
    if (selector) {
      const box = await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)})
        if (!node) return null
        const r = node.getBoundingClientRect()
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
      })()`)
      if (!box) throw new Error(`页面上找不到选择器：${selector}`)
      clip = {
        x: Math.max(0, Math.round(box.x)),
        y: Math.max(0, Math.round(box.y)),
        width: Math.max(1, Math.round(box.width)),
        height: Math.max(1, Math.round(box.height)),
        scale: 1,
      }
    } else if (forcedHeight) {
      if (forcedHeight !== viewportHeight) {
        await setViewport(viewportWidth, forcedHeight)
        await sleep(100)
      }
      clip = { x: 0, y: 0, width: viewportWidth, height: forcedHeight, scale: 1 }
    } else if (height === undefined || fullPage) {
      // Neither scrollHeight nor Page.getLayoutMetrics ever report less than
      // the viewport, so measure the real content box from the body subtree.
      const contentHeight = Number(await evaluate(`(() => {
        const body = document.body
        if (!body) return document.documentElement.getBoundingClientRect().height
        let bottom = body.getBoundingClientRect().height
        for (const node of body.querySelectorAll('*')) {
          const rect = node.getBoundingClientRect()
          if (rect.height > 0 && rect.bottom + window.scrollY > bottom) bottom = rect.bottom + window.scrollY
        }
        return Math.ceil(bottom)
      })()`))
      const targetHeight = Math.min(maxHeight, Math.max(120, Math.round(Number.isFinite(contentHeight) ? contentHeight : 0)))
      await setViewport(viewportWidth, targetHeight)
      await sleep(120)
      clip = { x: 0, y: 0, width: viewportWidth, height: viewportHeight, scale: 1 }
    } else {
      clip = { x: 0, y: 0, width: viewportWidth, height: viewportHeight, scale: 1 }
    }

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip,
    })
    await writeFile(outPath, Buffer.from(shot.data, 'base64'))
    const info = await stat(outPath)
    return {
      path: outPath,
      bytes: info.size,
      width: Math.round(clip.width * scale),
      height: Math.round(clip.height * scale),
    }
  } finally {
    cdp?.close()
    await stopBrowser(session.child, session.dir)
  }
}
