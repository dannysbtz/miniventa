import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportSPKI } from 'jose'
import { apiBase } from '../src/auth/platform.js'
import { validateOfflinePublicKey } from '../src/auth/offline.js'

test('API configuration requires an HTTPS URL with no embedded credentials', () => {
  assert.equal(apiBase('https://api.example.com'), 'https://api.example.com')
  for (const value of ['', undefined, 'http://api.example.com', 'https://user:pass@api.example.com', 'https://api.example.com?key=x', 'https://api.example.com/#fragment']) {
    assert.throws(() => apiBase(value), /VITE_API_URL/)
  }
})

test('offline verification key must be a valid RSA key of at least 2048 bits', async () => {
  const keys = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
  const publicKey = await exportSPKI(keys.publicKey)
  assert.ok(await validateOfflinePublicKey(publicKey))
  await assert.rejects(validateOfflinePublicKey(''), /VITE_OFFLINE_PUBLIC_KEY/)
  await assert.rejects(validateOfflinePublicKey('not a PEM key'))
})