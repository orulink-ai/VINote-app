import MarkdownIt from 'markdown-it'

// 原生渲染，不执行 HTML；正文和摘要使用同一解析器。
export const markdownParser = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true })

export function markdownPreview(content: string): string {
  const result: string[] = []
  const visit = (tokens: ReturnType<typeof markdownParser.parse>) => {
    for (const token of tokens) {
      if (token.children) visit(token.children)
      else if (['text', 'code_inline', 'fence', 'code_block'].includes(token.type)) result.push(token.content)
      else if (token.type === 'softbreak' || token.type === 'hardbreak' || token.block) result.push(' ')
    }
  }
  visit(markdownParser.parse(content, {}))
  return result.join('').replace(/\s+/g, ' ').trim()
}
