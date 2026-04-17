// Lightweight multi-framework source resolver.
// Reads debug metadata that frameworks stamp on DOM elements in dev mode.
// No external dependencies — replaces element-source/bippy.

export interface SourceInfo {
  component: string | null
  file: string | null
  line: number | null
  column: number | null
}

// --- React ---
// Fibers are attached as __reactFiber$<hash> on DOM elements.
// Walk up fiber.return to find nearest function component.
// _debugSource (dev mode) has { fileName, lineNumber, columnNumber }.

function resolveReact(el: Element): SourceInfo | null {
  try {
    const fiberKey = Object.keys(el).find(
      k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    )
    if (!fiberKey) return null
    const fiber = (el as any)[fiberKey]
    let cur = fiber
    while (cur) {
      if (cur.type && typeof cur.type === 'function') {
        const name = cur.type.displayName || cur.type.name
        if (name && name.length > 1 && name[0] === name[0].toUpperCase()
            && name !== 'Fragment' && name !== 'Suspense') {
          const src = cur._debugSource
          return {
            component: name,
            file: src?.fileName ?? null,
            line: src?.lineNumber ?? null,
            column: src?.columnNumber ?? null,
          }
        }
      }
      cur = cur.return
    }
  } catch {}
  return null
}

// --- Vue ---
// Vue 3 attaches __vueParentComponent on DOM elements.
// Vue devtools inspector plugin adds data-v-inspector="file:line:col" attribute.

function resolveVue(el: Element): SourceInfo | null {
  try {
    // Try data-v-inspector attribute first (most precise)
    const inspector = el.getAttribute('data-v-inspector')
    if (inspector) {
      const parts = inspector.split(':')
      if (parts.length >= 2) {
        const file = parts.slice(0, -2).join(':') || parts[0]
        const line = parseInt(parts[parts.length - 2], 10)
        const col = parseInt(parts[parts.length - 1], 10)
        // Walk up for component name
        const component = getVueComponentName(el)
        return {
          component,
          file,
          line: isNaN(line) ? null : line,
          column: isNaN(col) ? null : col,
        }
      }
    }
    // Try __vueParentComponent for name at least
    const name = getVueComponentName(el)
    if (name) {
      return { component: name, file: null, line: null, column: null }
    }
  } catch {}
  return null
}

function getVueComponentName(el: Element): string | null {
  let current: Element | null = el
  while (current) {
    const component = (current as any).__vueParentComponent
    if (component) {
      const type = component.type
      if (type) {
        const name = type.name || type.__name
        if (name && name !== 'Fragment') return name
      }
    }
    current = current.parentElement
  }
  return null
}

// --- Svelte ---
// Svelte stamps __svelte_meta on DOM elements in dev mode.
// Contains loc: { file, line, column } and parent chain with componentTag.

function resolveSvelte(el: Element): SourceInfo | null {
  try {
    let current: Element | null = el
    while (current) {
      const meta = (current as any).__svelte_meta
      if (meta?.loc) {
        const loc = meta.loc
        const file = typeof loc.file === 'string' ? loc.file : null
        const line = typeof loc.line === 'number' ? loc.line : null
        const column = typeof loc.column === 'number' ? loc.column + 1 : null // Svelte is 0-indexed
        // Walk parent chain for component name
        let component: string | null = null
        let p = meta.parent
        while (p) {
          if (typeof p.componentTag === 'string') { component = p.componentTag; break }
          p = p.parent
        }
        return { component, file, line, column }
      }
      current = current.parentElement
    }
  } catch {}
  return null
}

// --- Preact ---
// Preact vnodes have __source (dev mode) with fileName/lineNumber.
// VNodes are linked to DOM via __e, walkable via __ (parent) and __o (owner).

function resolvePreact(el: Element): SourceInfo | null {
  try {
    // Find vnode for this element by checking __k (children) on parent vnodes
    // Simpler: Preact also uses __reactFiber$ in compat mode, caught by React resolver.
    // For pure Preact: walk the component tree via _component or __c
    const component = (el as any).__c || (el as any)._component
    if (component) {
      const name = component.constructor?.displayName || component.constructor?.name
      const src = component.__v?.__source || component.props?.__source
      return {
        component: name && name !== 'Fragment' ? name : null,
        file: src?.fileName ?? null,
        line: src?.lineNumber ?? null,
        column: src?.columnNumber ?? null,
      }
    }
  } catch {}
  return null
}

// --- Public API ---

const resolvers = [resolveReact, resolveVue, resolveSvelte, resolvePreact]

/**
 * Resolve source info for a DOM element. Tries each framework in order.
 * Returns null if no framework metadata found (plain HTML, or prod build).
 */
export function resolveElementSource(el: Element): SourceInfo | null {
  for (const resolve of resolvers) {
    const info = resolve(el)
    if (info) return info
  }
  return null
}

/**
 * Format source info as a compact string for query_dom attributes.
 * Returns "file:line" or "file:line:col" or null.
 */
export function formatSource(info: SourceInfo): string | null {
  if (!info.file) return null
  let s = info.file
  if (info.line != null) s += ':' + info.line
  if (info.column != null) s += ':' + info.column
  return s
}
