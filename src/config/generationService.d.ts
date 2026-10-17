type Deployment = { generationBaseUrl?: unknown; apiBaseUrl?: string; integrationBaseUrl?: string; authBaseUrl?: string }
export function validateGenerationBaseUrl(config: Deployment, options?: { required?: boolean }): string
export function resolveGenerationBaseUrl(config: Deployment, development: boolean): string
