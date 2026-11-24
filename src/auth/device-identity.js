import { Capacitor, registerPlugin } from '@capacitor/core'

const nativeIdentity = registerPlugin('DeviceIdentity')
let browserIdentity

function pemToBytes(pem) {
  const contents = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const binary = atob(contents)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function toBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function p1363ToDer(signature) {
  const integer = (part) => {
    let first = 0
    while (first < part.length - 1 && part[first] === 0) first++
    const value = part.subarray(first)
    const needsZero = (value[0] & 0x80) !== 0
    const encoded = needsZero ? Uint8Array.from([0, ...value]) : value
    return Uint8Array.from([0x02, encoded.length, ...encoded])
  }
  const bytes = new Uint8Array(signature)
  if (bytes.length !== 64) throw new Error('Firma ECDSA web inválida.')
  const r = integer(bytes.subarray(0, 32))
  const s = integer(bytes.subarray(32))
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s])
}

async function fingerprint(publicKey) {
  const digest = await crypto.subtle.digest('SHA-256', pemToBytes(publicKey))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function getDeviceIdentity() {
  if (Capacitor.isNativePlatform()) {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('DeviceIdentity')) {
      throw new Error('No está disponible la identidad segura de Android.')
    }
    const { publicKey } = await nativeIdentity.getPublicKey()
    if (typeof publicKey !== 'string' || !publicKey.includes('BEGIN PUBLIC KEY')) throw new Error('Identidad del dispositivo inválida.')
    return {
      publicKey,
      fingerprint: await fingerprint(publicKey),
      sign: async (value) => (await nativeIdentity.sign({ value })).proof,
    }
  }

  if (!browserIdentity) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const encoded = await crypto.subtle.exportKey('spki', pair.publicKey)
    const binary = [...new Uint8Array(encoded)].map((byte) => String.fromCharCode(byte)).join('')
    const base64 = btoa(binary).match(/.{1,64}/g).join('\n')
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`
    browserIdentity = {
      publicKey,
      fingerprint: await fingerprint(publicKey),
      sign: async (value) => toBase64Url(p1363ToDer(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(value)))),
    }
  }
  return browserIdentity
}