import MarkdownIt from 'markdown-it'

// Native rendering never executes HTML. Preview transformations do not mutate saved Markdown.
export const markdownParser = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true })

export function markdownPreview(content: string): string {
  const result: string[] = []
  const screenshotLabel = /^screenshot\s*:?\s*\d{1,2}:\d{2}(?::\d{2})?$/i
  const visit = (tokens: ReturnType<typeof markdownParser.parse>) => {
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      // Image children contain the alt text (e.g. Screenshot 00:09), not prose.
      if (token.type === 'image') { result.push(' '); continue }
      if (token.type === 'link_open') {
        const end = tokens.findIndex((next, position) => position > index && next.type === 'link_close')
        const label = end >= 0 ? tokens.slice(index + 1, end).map(child => child.content).join('').trim() : ''
        if (end >= 0 && (screenshotLabel.test(label) || /^https?:\/\//i.test(label))) { index = end; result.push(' '); continue }
      }
      if (token.children) visit(token.children)
      else if (['text', 'code_inline', 'fence', 'code_block'].includes(token.type)) result.push(token.content)
      else if (token.type === 'softbreak' || token.type === 'hardbreak' || token.block) result.push(' ')
    }
  }
  const previewSource = content
    .replace(/\[\[\s*Screenshot\s*:[^\]\r\n]+\]\]/gi, ' ')
    // Incomplete Markdown links sometimes occur in imported snippets; keep their label.
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/|\/api\/)[^\n)]*$/gm, '$1')
  visit(markdownParser.parse(previewSource, {}))
  return result.join('').replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\s+/g, ' ').trim()
}
