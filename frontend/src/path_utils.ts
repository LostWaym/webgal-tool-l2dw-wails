// 路径相关工具的统一出口。
//
// 设计目标：
//  - 浏览器 + Vite 环境，不依赖 Node `path` 模块；
//  - 同时处理 POSIX（`/`）和 Windows（`\\`）两种分隔符输入；
//  - 提供与后端 `/abs_files/<abs-path>` 路由对接的 URL 构造助手 `toFileUrl`。

/**
 * 取路径最后一段（文件名）。同时识别 `/` 和 `\\` 分隔符。
 * 与原 `posixBasename` / `pathBasename` 行为一致。
 */
export function pathBasename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
}

/**
 * 取路径的目录部分（不含最后一段）。如果只有一段则返回空串。
 */
export function pathDirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(0, idx) : ''
}

/**
 * 判断路径是否为绝对路径，覆盖三种形态：
 *   - POSIX  形如 `/foo/bar`
 *   - UNC    形如 `\\server\share\foo`
 *   - Windows 盘符 形如 `C:\foo` 或 `C:/foo`
 */
export function pathIsAbsolute(p: string): boolean {
  if (!p) return false
  if (p[0] === '/' || p[0] === '\\') return true
  return /^[A-Za-z]:[\\/]/.test(p)
}

/**
 * 把绝对路径转成后端 `/abs_files/` 路由可解析的 URL。
 *
 * 契约：
 *  - 输入必须是绝对路径（POSIX / Windows / UNC），由调用方保证；
 *  - 路径为空时返回 `''`，方便调用方短路。
 */
export function toFileUrl(absPath: string): string {
  if (!absPath) return ''
  return `/abs_files/${absPath}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 路径相对 / 拼接
// ─────────────────────────────────────────────────────────────────────────────

type Root = { kind: 'posix' } | { kind: 'drive'; letter: string } | { kind: 'unc'; host: string; share: string }

const normSlashes = (p: string): string => p.replace(/\\/g, '/')

/**
 * 取一个路径的"根"，用于判断两个绝对路径是否在同一棵树下。
 *  - POSIX `/foo` → `{kind: 'posix'}`
 *  - Windows `C:\foo` 或 `C:/foo` → `{kind: 'drive', letter: 'C'}`（大小写不敏感）
 *  - UNC `\\server\share\foo` → `{kind: 'unc', host, share}`
 * 其它形态返回 `null`（视为非绝对路径）。
 */
function pathRoot(p: string): Root | null {
  if (!p) return null
  const s = normSlashes(p)
  const unc = s.match(/^\/\/([^/]+)\/([^/]+)/)
  if (unc) return { kind: 'unc', host: unc[1], share: unc[2] }
  if (s[0] === '/') return { kind: 'posix' }
  const drv = s.match(/^([A-Za-z]):\//)
  if (drv) return { kind: 'drive', letter: drv[1].toUpperCase() }
  return null
}

function rootsEqual(a: Root, b: Root): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'posix':
      return b.kind === 'posix'
    case 'drive':
      return b.kind === 'drive' && a.letter === b.letter
    case 'unc':
      return (
        b.kind === 'unc' &&
        a.host.toLowerCase() === b.host.toLowerCase() &&
        a.share.toLowerCase() === b.share.toLowerCase()
      )
  }
  return false
}

/**
 * 计算 `target` 相对于 `base` 的相对路径（POSIX 风格，使用 `/` 分隔符）。
 *
 * 规则：
 *  - `base` 为空或 `''` → 返回 `target` 原值；
 *  - `target` 不是绝对路径 → 返回 `target` 原值；
 *  - 两者都是绝对路径，但根（盘符 / UNC / POSIX 根）不同 → 返回 `target` 原值；
 *  - 其余情况：按共同前缀去除 + `..` 回溯 + 下钻，构造 POSIX 风格相对路径；
 *  - `base === target` 时返回 `'.'`。
 *
 * Windows 盘符大小写不敏感（`C:` vs `c:` 视为同一根）；UNC 路径以 `//host/share`
 * 作为根比较。
 */
export function pathRelative(base: string, target: string): string {
  if (!base) return target
  if (!pathIsAbsolute(target)) return target

  const normBase = normSlashes(base)
  const normTarget = normSlashes(target)
  const baseR = pathRoot(normBase)
  const targetR = pathRoot(normTarget)
  if (!baseR || !targetR) return target
  if (!rootsEqual(baseR, targetR)) return target

  const stripRoot = (p: string, r: Root): string => {
    switch (r.kind) {
      case 'posix':
        return p.replace(/^\/+/, '')
      case 'drive':
        return p.replace(/^[A-Za-z]:\//, '')
      case 'unc':
        return p.replace(/^\/\/[^/]+\/[^/]+\//, '')
    }
  }
  const baseParts = stripRoot(normBase, baseR).split('/').filter(Boolean)
  const targetParts = stripRoot(normTarget, baseR).split('/').filter(Boolean)

  if (normBase === normTarget) return '.'
  if (baseParts.length === 0 && targetParts.length === 0) return '.'

  let i = 0
  while (i < baseParts.length && i < targetParts.length && baseParts[i] === targetParts[i]) i++

  const up = baseParts.length - i
  const down = targetParts.slice(i)
  const rel = [...Array(up).fill('..'), ...down].join('/')
  return rel || '.'
}

/**
 * 把 `rel`（相对路径）按 `base` 所在的目录拼接成一个绝对路径。
 *
 * 规则：
 *  - `base` 为空或 `''` → 返回 `rel` 原值（无基址可参考）；
 *  - `rel` 本身已是绝对路径 → 直接返回 `rel`，覆盖 `base`；
 *  - 其余情况：把 `rel` 当 POSIX 风格相对路径展开（含 `..` 与 `.` 段），
 *    最终还原到与 `base` 一致的分隔符风格（Windows 用 `\\`，POSIX 用 `/`）。
 *
 * 用于把 wmdl 中序列化下来的"相对 extres 模型路径"重新解析成"绝对路径"，
 * 从而让运行时 `/abs_files/` 路由能服务该文件。
 */
export function pathCombine(base: string, rel: string): string {
  if (!base) return rel
  if (!rel) return rel
  if (pathIsAbsolute(rel)) return rel

  const normBase = normSlashes(base)
  const r = pathRoot(normBase)
  if (!r) return rel

  let anchor: string[]
  let tailSep: string
  switch (r.kind) {
    case 'posix':
      anchor = normBase.replace(/^\/+/, '').split('/').filter((s) => s.length > 0)
      tailSep = '/'
      break
    case 'drive':
      anchor = normBase.replace(/^[A-Za-z]:\//, '').split('/').filter((s) => s.length > 0)
      tailSep = '\\'
      break
    case 'unc':
      anchor = normBase.replace(/^\/\/[^/]+\/[^/]+\//, '').split('/').filter((s) => s.length > 0)
      tailSep = '\\'
      break
  }

  const normRel = normSlashes(rel)
  const relParts = normRel.split('/').filter((s) => s.length > 0)
  const stack = [...anchor]
  for (const seg of relParts) {
    if (seg === '.') continue
    if (seg === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(seg)
  }

  switch (r.kind) {
    case 'posix':
      return `/${stack.join('/') || ''}`
    case 'drive':
      return `${r.letter}:${tailSep}${stack.join(tailSep)}`
    case 'unc':
      return `\\\\${r.host}\\${r.share}\\${stack.join(tailSep)}`
  }
}