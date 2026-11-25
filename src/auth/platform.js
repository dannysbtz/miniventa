import { Capacitor } from '@capacitor/core'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

export function sessionStorage() {
  if (!Capacitor.isNativePlatform()) {
    let value = null
    return { get: async () => value, set: async (next) => { value = structuredClone(next) }, clear: async () => { value = null } }
  }
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('SecureStorage')) throw new Error('Almacenamiento seguro Android no disponible')
  return { get: () => SecureStorage.get('session'), set: (value) => SecureStorage.set('session', value), clear: () => SecureStorage.remove('session') }
}

export function apiBase(configured) {
  let url
  try { url = new URL(configured) } catch { throw new Error('Configura VITE_API_URL con una URL HTTPS válida') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('VITE_API_URL debe ser HTTPS y no contener credenciales, consulta ni fragmento')
  return url.href.replace(/\/$/, '')
}