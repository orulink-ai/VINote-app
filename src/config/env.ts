import deployment from '../../config/deployment.json'
// 发布时统一内置地址，安装者不需要配置。公网入口由部署方提供。
export const API_BASE_URL = deployment.apiBaseUrl
export const AUTH_BASE_URL = deployment.authBaseUrl
export const SUPABASE_URL = AUTH_BASE_URL
export const SUPABASE_KEY = 'sb_publishable_Nx0nLCISW78UUzhSY7tyuo_YiwouSTj'
