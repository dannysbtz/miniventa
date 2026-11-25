import { importSPKI, jwtVerify } from 'jose'

export const MAX_OFFLINE_SECONDS = 7 * 24 * 60 * 60
export const CLOCK_TOLERANCE_MS = 120000

export async function validateOfflinePublicKey(publicKey) {
  if (!publicKey) throw new Error('Configura VITE_OFFLINE_PUBLIC_KEY con la clave pública confiable')
  const key = await importSPKI(publicKey.replace(/\\n/g, '\n'), 'RS256')
  if (key.algorithm.modulusLength < 2048) throw new Error('La clave pública RSA debe tener al menos 2048 bits')
  return key
}

export async function verifyOffline(token, publicKey, now = Date.now(), expectedDeviceKey) {
  const key = await validateOfflinePublicKey(publicKey)
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['RS256'], issuer: 'miniventa-api', audience: 'miniventa-offline',
    currentDate: new Date(now), requiredClaims: ['sub', 'iat', 'exp', 'subscriptionEndsAt', 'token_use'],
  })
  const ends = Date.parse(payload.subscriptionEndsAt)
  const seconds = Math.floor(now / 1000)
  if (payload.token_use !== 'offline' || typeof payload.sub !== 'string' || !payload.sub ||
      typeof payload.deviceKey !== 'string' || !/^[a-f\d]{64}$/.test(payload.deviceKey) ||
      (expectedDeviceKey != null && payload.deviceKey !== expectedDeviceKey) ||
      typeof payload.name !== 'string' || !payload.name || !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) || payload.iat > seconds || payload.exp <= payload.iat ||
      payload.exp - payload.iat > MAX_OFFLINE_SECONDS || seconds - payload.iat >= MAX_OFFLINE_SECONDS ||
      typeof payload.subscriptionEndsAt !== 'string' || !Number.isFinite(ends) || ends <= now ||
      payload.exp * 1000 > ends) throw new Error('Autorización offline inválida o vencida')
  return payload
}

export function advanceClock(previous, wall, monotonicElapsed = 0) {
  if (!Number.isFinite(wall) || !Number.isFinite(monotonicElapsed) || monotonicElapsed < 0 ||
      (previous != null && (!Number.isFinite(previous) || wall + CLOCK_TOLERANCE_MS < previous + monotonicElapsed))) {
    throw new Error('El reloj del dispositivo retrocedió; conecta a internet e inicia sesión')
  }
  return Math.max(wall, (previous ?? wall) + monotonicElapsed)
}