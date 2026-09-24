import deployment from '../../config/deployment.json'
// 发布时统一内置地址，安装者不需要配置。公网入口由部署方提供。
export const API_BASE_URL = deployment.apiBaseUrl
export const AUTH_BASE_URL = deployment.authBaseUrl
export const SUPABASE_URL = 'https://jzwidvczdjbkontidwpy.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_MV7Id52D3PcydQE5hygxVg_gxPqZbfZ'
