import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { getDeviceIdentity } from '../src/auth/device-identity.js'

test('la identidad web de desarrollo genera huella estable y firma verificable por el backend', async () => {
  const identity = await getDeviceIdentity()
  const signature = Buffer.from(await identity.sign('reto de dispositivo'), 'base64url')
  const publicKey = crypto.createPublicKey(identity.publicKey)
  const fingerprint = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  assert.equal(identity.fingerprint, fingerprint)
  assert.equal(identity.fingerprint.length, 64)
  assert.equal(crypto.verify('sha256', Buffer.from('reto de dispositivo'), publicKey, signature), true)
  assert.equal(await getDeviceIdentity(), identity)
})
