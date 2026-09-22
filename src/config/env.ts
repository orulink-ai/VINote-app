import { Platform } from 'react-native'

const configuredBaseUrl = ''

export const API_BASE_URL = configuredBaseUrl || (Platform.OS === 'android'
  ? 'http://10.0.2.2:8900'
  : 'http://127.0.0.1:8900')
