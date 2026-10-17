import type { RemoteScope } from './sessionGate'
export async function prepareWorkspaceMarkdown(markdown: string, _owner: string, _scope?: RemoteScope, guard?: () => void) {
  guard?.()
  return markdown // No automatic download or attachment upload.
}
