import { advanceClock, verifyOffline } from './offline.js'

export const RETRY_MESSAGE = 'Es necesario conectarse a internet para estar actualizado'

export function createAuth({ apiUrl, publicKey, storage, deviceIdentity, fetcher = fetch, now = Date.now, monotonic = () => performance.now(), timeout = 10000, onChange = () => {} }) {
  let state = { status: 'login', message: '', user: null, failures: 0 }
  let saved = null
  let identity = null
  let lastMono = monotonic()
  let queue = Promise.resolve()
  let pendingRefresh = null
  const emit = (patch) => { state = { ...state, ...patch }; onChange({ ...state }) }
  const serial = (work) => { const result = queue.then(work, work); queue = result.catch(() => {}); return result }
  const persist = async () => { if (saved) await storage.set(saved) }
  const clear = async (message) => {
    saved = null
    emit({ status: 'login', user: null, message, failures: 0 })
    try { await storage.clear() } catch { emit({ status: 'blocked', user: null, message: 'No se pudo borrar la sesión segura. Reinicia la aplicación y vuelve a intentarlo.' }) }
  }
  const checkClock = async () => {
    const currentMono = monotonic()
    saved.clock = advanceClock(saved.clock, now(), Math.max(0, currentMono - lastMono))
    lastMono = currentMono
    await persist()
    return saved.clock
  }
  const authorize = async (notice = '') => {
    const clock = await checkClock()
    const claims = await verifyOffline(saved.offlineToken, publicKey, clock, identity.fingerprint)
    if (claims.sub !== saved.user.id || claims.deviceKey !== identity.fingerprint || saved.deviceKey !== identity.fingerprint) throw new Error('La autorización no pertenece a este dispositivo')
    emit({ status: 'ready', user: { id: claims.sub, name: claims.name }, message: saved.failures >= 10 ? RETRY_MESSAGE : notice, failures: saved.failures, validUntil: claims.exp * 1000 })
  }
  const request = async (path, options) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      let response
      try { response = await fetcher(`${apiUrl}${path}`, { ...options, signal: controller.signal, cache: 'no-store' }) }
      catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) throw Object.assign(new Error('No se pudo conectar al servidor.'), { network: true })
        throw error
      }
      let body = null
      if (response.ok) {
        try { body = await response.json() } catch { body = null }
      }
      return { status: response.status, ok: response.ok, body }
    }
    finally { clearTimeout(timer) }
  }
  const signedRequest = async (path, options) => {
    const challenge = await request('/api/auth/device-challenge', { method: 'POST' })
    if (!challenge.ok || typeof challenge.body?.challenge !== 'string') return challenge
    const proof = await identity.sign(challenge.body.challenge)
    return request(path, {
      ...options,
      headers: { ...options.headers, 'X-Device-Challenge': challenge.body.challenge, 'X-Device-Proof': proof },
    })
  }
  const refresh = async () => {
    if (!saved) return
    let response
    try { response = await signedRequest('/api/auth/renew', { method: 'POST', headers: { Authorization: `Bearer ${saved.sessionToken}` } }) }
    catch (error) {
      if (error.network) saved.failures = (saved.failures || 0) + 1
      try { await authorize(error.network ? '' : 'No se pudo verificar la sesión.') }
      catch (offlineError) { emit({ status: 'blocked', user: null, message: offlineError.message, failures: saved.failures }) }
      return
    }
    if (response.status === 401) { await clear('Sesión inválida o vencida. Inicia sesión de nuevo.'); return }
    if (response.status === 403) { await clear('La suscripción está inactiva o vencida.'); return }
    saved.failures = 0
    if (!response.ok) {
      try { await authorize('No se pudo verificar la sesión.') } catch (error) { emit({ status: 'blocked', user: null, message: error.message, failures: saved.failures }) }
      return
    }
    try {
      const body = response.body
      const clock = await checkClock()
      const claims = await verifyOffline(body?.offlineToken, publicKey, clock, identity.fingerprint)
      if (claims.sub !== saved.user.id || claims.deviceKey !== identity.fingerprint || body.user?.id !== claims.sub || body.subscription?.status !== 'active') throw new Error('Respuesta de autenticación inválida')
      saved = { ...saved, offlineToken: body.offlineToken, user: body.user, failures: 0 }
      await persist()
      await authorize()
    } catch (error) {
      if (!saved) return
      try { await authorize('Respuesta de autenticación inválida; vuelve a verificar la conexión') }
      catch (offlineError) { emit({ status: 'blocked', user: null, message: offlineError.message, failures: saved.failures }) }
    }
  }
  return {
    getState: () => ({ ...state }),
    start: () => serial(async () => {
      try {
        saved = await storage.get()
        identity = await deviceIdentity()
        lastMono = monotonic()
        if (!saved) return
        if (typeof saved.sessionToken !== 'string' || typeof saved.offlineToken !== 'string' || typeof saved.deviceKey !== 'string' || saved.deviceKey !== identity.fingerprint || !saved.user?.id || !Number.isFinite(saved.clock) || !Number.isInteger(saved.failures) || saved.failures < 0) throw new Error('La sesión no pertenece a este dispositivo')
        try { await authorize() } catch (error) { emit({ status: 'blocked', user: null, message: error.message }) }
        await refresh()
      } catch (error) { saved = null; emit({ status: 'blocked', user: null, message: `Almacenamiento seguro no disponible: ${error.message}` }) }
    }),
    login: (username, password) => serial(async () => {
      try {
        identity = identity || await deviceIdentity()
        const challengeResponse = await request('/api/auth/device-challenge', { method: 'POST' })
        if (!challengeResponse.ok || typeof challengeResponse.body?.challenge !== 'string') {
          emit({ status: 'login', failures: 0, message: challengeResponse.status === 429 ? 'Demasiadas solicitudes. Vuelve a intentarlo más tarde.' : 'No se pudo verificar el dispositivo.' })
          return
        }
        const deviceProof = await identity.sign(challengeResponse.body.challenge)
        const response = await request('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, devicePublicKey: identity.publicKey, deviceChallenge: challengeResponse.body.challenge, deviceProof }),
        })
        emit({ failures: 0 })
        if (response.status === 202 && response.body?.error === 'device_change_pending') {
          saved = null
          await storage.clear()
          emit({ status: 'devicePending', user: null, requestId: response.body.requestId, message: 'El cambio de dispositivo está pendiente de aprobación del administrador.' })
          return
        }
        if (response.status === 403) { emit({ status: 'login', message: 'La suscripción está inactiva o vencida.' }); return }
        if (!response.ok) {
          emit({ status: 'login', failures: 0, message: response.status === 429 ? 'Demasiados intentos. Vuelve a intentarlo más tarde.' : response.status === 401 ? 'Usuario o contraseña incorrectos.' : 'No se pudo iniciar sesión.' })
          return
        }
        const body = response.body
        const clock = now()
        const claims = await verifyOffline(body.offlineToken, publicKey, clock, identity.fingerprint)
        if (typeof body.sessionToken !== 'string' || !body.sessionToken || body.user?.id !== claims.sub || claims.deviceKey !== identity.fingerprint || body.subscription?.status !== 'active') throw new Error('Respuesta de autenticación inválida')
        saved = { sessionToken: body.sessionToken, offlineToken: body.offlineToken, user: body.user, deviceKey: identity.fingerprint, failures: 0, clock }
        lastMono = monotonic()
        await persist()
        await authorize()
      } catch (error) {
        saved = null
        const network = error.network === true
        const failures = network ? state.failures + 1 : state.failures
        emit({ status: 'login', failures, message: network && failures >= 10 ? RETRY_MESSAGE : network ? 'No se pudo conectar al servidor.' : error.message })
      }
    }),
    refresh: () => {
      if (!pendingRefresh) pendingRefresh = serial(refresh).finally(() => { pendingRefresh = null })
      return pendingRefresh
    },
    check: () => serial(async () => {
      if (!saved) return
      try { await authorize() } catch (error) { emit({ status: 'blocked', user: null, message: error.message }) }
    }),
    logout: () => serial(() => clear('Sesión cerrada.')),
  }
}