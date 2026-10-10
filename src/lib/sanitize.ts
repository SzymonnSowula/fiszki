const BLOCKED = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'])

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''
  root.querySelectorAll(Array.from(BLOCKED).join(',')).forEach((node) => node.remove())
  root.querySelectorAll('*').forEach((element) => {
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc') element.removeAttribute(attr.name)
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) {
        element.removeAttribute(attr.name)
      }
    }
  })
  return root.innerHTML
}

export function sanitizeCss(css: string): string {
  return css.replace(/<\/style/gi, '').replace(/@import/gi, '').replace(/expression\s*\(/gi, '')
}
