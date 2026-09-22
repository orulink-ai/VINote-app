import * as Keychain from 'react-native-keychain'

const SERVICE = 'com.vinote.app.session'

export async function saveToken(token: string) {
  await Keychain.setGenericPassword('vinote', token, { service: SERVICE })
}

export async function readToken() {
  const credentials = await Keychain.getGenericPassword({ service: SERVICE })
  return credentials ? credentials.password : null
}

export async function clearToken() {
  await Keychain.resetGenericPassword({ service: SERVICE })
}
