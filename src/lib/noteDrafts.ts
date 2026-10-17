import { workspaceOwner } from './workspaceStorage'
export const draftKey = async (id: string) => `vinote:${await workspaceOwner()}:editor-draft:${id}`
