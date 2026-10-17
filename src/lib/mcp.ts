import { integrationJson } from './integration'
export type MCPConnection = { id: string; name: string; url: string; authType: 'none' | 'token' | 'vinote-session'; managed?: boolean; providerId?: string | null; hasCredential: boolean; enabled: boolean; status: 'unverified' | 'connected' | 'error'; lastError: string | null; discoveredAt: string | null }
export type MCPTool = { name: string; description: string; inputSchema: object; enabled: boolean; definitionHash: string; requiresConfirmation: true }
export type MCPRun = { id: string; connectionId: string; requestId: string; toolName: string; status: 'awaiting_confirmation' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled'; arguments: object; result: object | null; error: { code: string; message: string } | null; confirmationToken: string | null; createdAt: string }
export const mcpApi = <T,>(path: string, init: RequestInit = {}, owner?: string) => integrationJson<T>(`/api/mcp-connections${path}`, init, owner, 50000)
export const runLabels: Record<MCPRun['status'], string> = { awaiting_confirmation: '待确认', running: '执行中', succeeded: '成功', failed: '失败', unknown: '结果未知，请核对远端', cancelled: '已取消待确认调用' }
