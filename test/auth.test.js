import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportSPKI, SignJWT } from 'jose'
import { advanceClock, verifyOffline } from '../src/auth/offline.js'
import { createAuth, RETRY_MESSAGE } from '../src/auth/controller.js'

const keys = await generateKeyPair('RS256', { extractable: true })
const publicKey = await exportSPKI(keys.publicKey)
const epoch = 1800000000
const clock = epoch * 1000
const deviceKey = 'a'.repeat(64)
const claims = { name: 'Ana', token_use: 'offline', deviceKey, subscriptionEndsAt: new Date(clock + 20 * 86400000).toISOString() }
async function token(payload = {}, header = {}) {
  return new SignJWT({ ...claims, ...payload }).setProtectedHeader({ alg: 'RS256', ...header }).setIssuer('miniventa-api').setAudience('miniventa-offline').setSubject('user-1').setIssuedAt(epoch).setExpirationTime(epoch + 7 * 86400).sign(keys.privateKey)
}
const validToken = await token()
const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const identity = { publicKey: 'test-device-public-key', fingerprint: deviceKey, sign: async () => 'test-proof' }
function fixture(fetcher) {
  let value = null
  let time = clock
  const storage = { get: async () => value && structuredClone(value), set: async (next) => { value = structuredClone(next) }, clear: async () => { value = null } }
  const wrappedFetcher = async (url, options) => url.endsWith('/device-challenge')
    ? response(200, { challenge: 'signed-challenge' })
    : fetcher(url, options)
  const create = () => createAuth({ apiUrl: '', publicKey, storage, fetcher: wrappedFetcher, deviceIdentity: async () => identity, now: () => time, monotonic: () => 0 })
  return { auth: create(), create, advance: (milliseconds) => { time += milliseconds }, getSaved: () => value }
}
const loginBody = { sessionToken: 'session', offlineToken: validToken, user: { id: 'user-1', name: 'Ana' }, subscription: { status: 'active' } }

test('JWT válido, expiración, firma y campos se verifican estrictamente', async () => {
  assert.equal((await verifyOffline(validToken, publicKey, clock)).sub, 'user-1')
  await assert.rejects(verifyOffline(await token({ deviceKey: undefined }), publicKey, clock))
  await assert.rejects(verifyOffline(await token({ deviceKey: 'b'.repeat(64) }), publicKey, clock, deviceKey), /Autorización offline inválida/)
  await assert.rejects(verifyOffline(validToken, publicKey, clock + 7 * 86400000))
  await assert.rejects(verifyOffline(await token({ token_use: 'session' }), publicKey, clock))
  await assert.rejects(verifyOffline(await token({ subscriptionEndsAt: new Date(clock - 1).toISOString() }), publicKey, clock))
  await assert.rejects(verifyOffline(`${validToken.slice(0, -4)}AAAA`, publicKey, clock))
  const longToken = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).setIssuer('miniventa-api').setAudience('miniventa-offline').setSubject('user-1').setIssuedAt(epoch).setExpirationTime(epoch + 8 * 86400).sign(keys.privateKey)
  await assert.rejects(verifyOffline(longToken, publicKey, clock))
  await assert.rejects(verifyOffline(validToken, '', clock))
})

test('reloj no retrocede significativamente y avanza con tiempo monotónico', () => {
  assert.equal(advanceClock(clock, clock + 100, 200), clock + 200)
  assert.throws(() => advanceClock(clock, clock - 120001))
})

test('diez fallos de renovación avisan sin bloquear y una renovación correcta recupera', async () => {
  let online = false
  const { auth, getSaved } = fixture(async (url) => url.endsWith('/login') ? response(200, loginBody) : online ? response(200, loginBody) : Promise.reject(new TypeError('network')))
  await auth.login('a', 'secret')
  assert.equal(auth.getState().status, 'ready')
  for (let count = 0; count < 10; count++) await auth.refresh()
  assert.equal(auth.getState().status, 'ready')
  assert.equal(auth.getState().message, RETRY_MESSAGE)
  assert.equal(getSaved().failures, 10)
  online = true
  await auth.refresh()
  assert.equal(auth.getState().status, 'ready')
  assert.equal(getSaved().failures, 0)
})

test('aviso persiste tras reiniciar y al vencer siete días bloquea incluso sin red', async () => {
  const setup = fixture(async (url) => url.endsWith('/login') ? response(200, loginBody) : Promise.reject(new TypeError('network')))
  await setup.auth.login('usuario', 'secret')
  for (let count = 0; count < 10; count++) await setup.auth.refresh()
  const restarted = setup.create()
  await restarted.start()
  assert.equal(restarted.getState().status, 'ready')
  assert.equal(restarted.getState().message, RETRY_MESSAGE)
  setup.advance(7 * 86400000)
  await restarted.check()
  assert.equal(restarted.getState().status, 'blocked')
  await restarted.refresh()
  assert.equal(restarted.getState().status, 'blocked')
})

test('login envía username y una respuesta inválida no cuenta como fallo de red', async () => {
  let sent
  const { auth } = fixture(async (_url, options) => { sent = JSON.parse(options.body); return response(200, {}) })
  await auth.login('Mi usuario', 'secret')
  assert.deepEqual(sent, { username: 'Mi usuario', password: 'secret', devicePublicKey: identity.publicKey, deviceChallenge: 'signed-challenge', deviceProof: 'test-proof' })
  assert.equal(auth.getState().failures, 0)
  assert.equal(auth.getState().status, 'login')
})

test('login pendiente no guarda sesión ni autoriza el dispositivo nuevo', async () => {
  const { auth, getSaved } = fixture(async () => response(202, { error: 'device_change_pending', requestId: 'request-123' }))
  await auth.login('usuario', 'secret')
  assert.equal(auth.getState().status, 'devicePending')
  assert.equal(auth.getState().requestId, 'request-123')
  assert.equal(getSaved(), null)
})

test('renovación exige firmar un reto con la identidad del dispositivo', async () => {
  let renewOptions
  const { auth } = fixture(async (url, options) => {
    if (url.endsWith('/login')) return response(200, loginBody)
    renewOptions = options
    return response(200, loginBody)
  })
  await auth.login('usuario', 'secret')
  await auth.refresh()
  assert.equal(renewOptions.headers['X-Device-Challenge'], 'signed-challenge')
  assert.equal(renewOptions.headers['X-Device-Proof'], 'test-proof')
  assert.equal(auth.getState().status, 'ready')
})

test('descarga de productos usa prueba de dispositivo y no borra sesión al fallar la red', async () => {
  let options
  let online = true
  const products = [{ number: '001', name: 'Pan', priceCents: 2000 }]
  const { auth, getSaved } = fixture(async (url, requestOptions) => {
    if (url.endsWith('/login')) return response(200, loginBody)
    options = requestOptions
    if (!online) throw new TypeError('network')
    return response(200, { products })
  })
  await auth.login('usuario', 'secret')
  assert.deepEqual(await auth.fetchProducts(), products)
  assert.equal(options.headers.Authorization, 'Bearer session')
  assert.equal(options.headers['X-Device-Challenge'], 'signed-challenge')
  assert.equal(options.headers['X-Device-Proof'], 'test-proof')
  online = false
  await assert.rejects(auth.fetchProducts(), /No se pudo conectar/)
  assert.equal(auth.getState().status, 'ready')
  assert.ok(getSaved())
})

test('401 y 403 invalidan sesión sin tratarlos como desconexión', async () => {
  for (const status of [401, 403]) {
    const { auth, getSaved } = fixture(async (url) => url.endsWith('/login') ? response(200, loginBody) : response(status))
    await auth.login('a', 'secret')
    await auth.refresh()
    assert.equal(auth.getState().status, 'login')
    assert.equal(getSaved(), null)
    assert.match(auth.getState().message, status === 401 ? /Sesión inválida/ : /suscripción está inactiva/)
  }
})

test('renovaciones concurrentes comparten petición y conservan la autorización anterior ante respuesta inválida', async () => {
  let requests = 0
  const { auth } = fixture(async (url) => {
    if (url.endsWith('/login')) return response(200, loginBody)
    requests++
    await new Promise((resolve) => setTimeout(resolve, 5))
    return response(200, { ...loginBody, offlineToken: 'invalid' })
  })
  await auth.login('a', 'secret')
  await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()])
  assert.equal(requests, 1)
  assert.equal(auth.getState().status, 'ready')
  assert.equal(auth.getState().failures, 0)
  assert.match(auth.getState().message, /Respuesta de autenticación inválida/)
  await auth.check()
  assert.equal(auth.getState().status, 'ready')
})

test('credenciales incorrectas y errores de servidor no son fallos de conexión', async () => {
  const { auth } = fixture(async () => response(401))
  for (let count = 0; count < 10; count++) await auth.login('a', 'wrong')
  assert.equal(auth.getState().failures, 0)
  assert.equal(auth.getState().message, 'Usuario o contraseña incorrectos.')
  const failingServer = fixture(async (url) => url.endsWith('/login') ? response(200, loginBody) : response(500))
  await failingServer.auth.login('a', 'secret')
  for (let count = 0; count < 10; count++) await failingServer.auth.refresh()
  assert.equal(failingServer.auth.getState().status, 'ready')
  assert.equal(failingServer.auth.getState().failures, 0)
})

test('una respuesta HTTP interrumpe la racha de fallos de red', async () => {
  let serverResponds = false
  const { auth, getSaved } = fixture(async (url) => url.endsWith('/login') ? response(200, loginBody) : serverResponds ? response(500) : Promise.reject(new TypeError('network')))
  await auth.login('usuario', 'secret')
  for (let count = 0; count < 9; count++) await auth.refresh()
  assert.equal(getSaved().failures, 9)
  serverResponds = true
  await auth.refresh()
  assert.equal(getSaved().failures, 0)
  serverResponds = false
  await auth.refresh()
  assert.equal(auth.getState().failures, 1)
  assert.notEqual(auth.getState().message, RETRY_MESSAGE)
})

test('diez fallos de conexión en login muestran el mensaje requerido', async () => {
  const { auth } = fixture(async () => { throw new TypeError('network') })
  for (let count = 0; count < 10; count++) await auth.login('a', 'secret')
  assert.equal(auth.getState().message, RETRY_MESSAGE)
})

test('una respuesta de login interrumpe la racha incluso si la respuesta es inválida o prohibida', async () => {
  for (const received of [response(403), response(200, {})]) {
    let online = false
    const { auth } = fixture(async () => online ? received : Promise.reject(new TypeError('network')))
    for (let count = 0; count < 9; count++) await auth.login('usuario', 'secret')
    online = true
    await auth.login('usuario', 'secret')
    assert.equal(auth.getState().failures, 0)
    online = false
    await auth.login('usuario', 'secret')
    assert.equal(auth.getState().failures, 1)
    assert.notEqual(auth.getState().message, RETRY_MESSAGE)
  }
})