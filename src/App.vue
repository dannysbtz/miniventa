<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { createAuth } from './auth/controller.js'
import { apiBase, sessionStorage } from './auth/platform.js'
import { validateOfflinePublicKey } from './auth/offline.js'
import { createRepository } from './data/repository.js'
import { summarizeCut } from './domain/cuts.js'
import { formatMoney, orderTotal, parseMoney } from './domain/money.js'
import { connectPrinter, disconnectPrinter, getPairedPrinters, getPrinterState, listenPrinterEvent, printBytes, scanPrinters, stopPrinterScan } from './printer/bluetooth.js'
import { buildGeneralReceipt, receiptPreview } from './printer/receipt.js'

const authState = ref({ status: 'loading', message: '', user: null, failures: 0 })
const credentials = reactive({ username: '', password: '' })
const tab = ref('orders')
const customerFilter = ref(null)
const busy = ref(false)
const error = ref('')
const dialog = ref(false)
const receiptPreviewDialog = ref(false)
const receiptPreviewText = ref('')
const receiptPreviewNumber = ref('')
const editing = ref(null)
const form = ref({})
const filteredProductOptions = ref([])
const printerState = ref({ supported: false, connected: false, name: null, address: null })
const printerDevices = ref([])
const scanningPrinter = ref(false)
const printerBusy = ref(false)
const printerError = ref('')
const receiptNotice = ref('')
const records = reactive({ products: [], customers: [], orders: [], cuts: [] })
const titles = { products: 'Productos', customers: 'Clientes', orders: 'Pedidos', cuts: 'Cortes' }
const singular = { products: 'producto', customers: 'cliente', orders: 'pedido', cuts: 'corte' }
let auth
let repository
let checkTimer
let renewTimer
let expiryTimer
let printerListeners = []
let generation = 0

const total = computed(() => {
  try { return formatMoney(orderTotal(form.value.products || [])) } catch { return '0.00' }
})
const customerOptions = computed(() => records.customers.map((item) => ({ label: item.name, value: item.id })))
const openCut = computed(() => records.cuts.find((cut) => cut.status === 'open') || null)
const sortedCuts = computed(() => [...records.cuts].sort((a, b) => b.openedAt.localeCompare(a.openedAt)))
const visibleRecords = computed(() => {
  const current = records[tab.value] || []
  if (tab.value !== 'orders' || !customerFilter.value) return current
  return current.filter((item) => item.customer.id === customerFilter.value)
})
const productOptions = computed(() => {
  const saved = [...(form.value.products || []), ...(form.value.changes || [])]
  const products = new Map([...saved, ...records.products].map((item) => [item.id, item]))
  return [...products.values()].map((item) => ({ label: item.name, value: item.id, priceCents: item.priceCents }))
})

function nextInternalNumber(type) {
  const taken = new Set((records[type] || []).map((item) => String(item.number)))
  let candidate = 1
  while (taken.has(String(candidate))) candidate++
  return String(candidate)
}

async function loadRecords() {
  const user = authState.value.user?.id
  if (!repository || !user) return
  const current = ++generation
  try {
    const [products, customers, orders, cuts] = await Promise.all(['products', 'customers', 'orders', 'cuts'].map((type) => repository.list(user, type)))
    if (current === generation && authState.value.user?.id === user) Object.assign(records, { products, customers, orders, cuts })
  } catch { if (current === generation) error.value = 'No se pudieron leer los datos locales.' }
}

watch(() => authState.value.user?.id, (id) => {
  generation++
  Object.assign(records, { products: [], customers: [], orders: [], cuts: [] })
  dialog.value = false
  if (id) loadRecords()
})

watch(tab, (value) => { if (value === 'printer') loadPrinters() })

async function login() {
  if (!credentials.username.trim() || !credentials.password) { error.value = 'Introduce usuario y contraseña.'; return }
  busy.value = true
  error.value = ''
  try { await auth.login(credentials.username.trim(), credentials.password) } finally { credentials.password = ''; busy.value = false }
}

function openEditor(item = null) {
  editing.value = item
  error.value = ''
  if (tab.value === 'products') form.value = item ? { ...item, price: formatMoney(item.priceCents), cost: item.costCents == null ? '' : formatMoney(item.costCents) } : { name: '', price: '', cost: '' }
  if (tab.value === 'customers') form.value = item ? { ...item } : { name: '' }
  if (tab.value === 'orders') form.value = item
    ? { ...JSON.parse(JSON.stringify(item)), customerId: item.customer.id, productId: null, changeId: null }
    : { customerId: null, productId: null, changeId: null, products: [], changes: [] }
  filteredProductOptions.value = productOptions.value
  dialog.value = true
}

function filterProducts(value, update) {
  const search = value.trim().toLocaleLowerCase()
  update(() => {
    filteredProductOptions.value = search
      ? productOptions.value.filter((item) => item.label.toLocaleLowerCase().includes(search))
      : productOptions.value
  })
}

function addProduct(type, productId) {
  if (!productId) return
  const field = type === 'changes' ? 'changeId' : 'productId'
  const existing = form.value[type].find((item) => item.id === productId)
  const product = records.products.find((item) => item.id === productId) || existing
  if (!product) return
  if (existing) existing.quantity++
  else form.value[type].push({ id: product.id, number: product.number, name: product.name, priceCents: product.priceCents, costCents: product.costCents, quantity: 1 })
  form.value[field] = null
}

function addPrinter(device) {
  if (!device?.address || printerDevices.value.some((item) => item.address === device.address)) return
  printerDevices.value.push(device)
}

async function loadPrinters() {
  if (!printerState.value.supported) return
  printerError.value = ''
  try {
    printerState.value = await getPrinterState()
    printerDevices.value = await getPairedPrinters()
  } catch (issue) { printerError.value = issue.message || 'No se pudieron consultar las impresoras.' }
}

async function searchPrinters() {
  printerError.value = ''
  try {
    printerDevices.value = await getPairedPrinters()
    scanningPrinter.value = true
    await scanPrinters()
  } catch (issue) {
    scanningPrinter.value = false
    printerError.value = issue.message || 'No se pudo buscar impresoras Bluetooth.'
  }
}

async function connectToPrinter(device) {
  printerBusy.value = true
  printerError.value = ''
  try { printerState.value = { supported: true, ...(await connectPrinter(device.address)) } }
  catch (issue) { printerError.value = issue.message || 'No se pudo conectar a la impresora.' }
  finally { printerBusy.value = false }
}

async function disconnectFromPrinter() {
  printerError.value = ''
  try { printerState.value = { supported: true, ...(await disconnectPrinter()) } }
  catch (issue) { printerError.value = issue.message || 'No se pudo desconectar la impresora.' }
}

async function printOrder(order) {
  receiptNotice.value = ''
  try {
    const state = await getPrinterState()
    printerState.value = state
    if (!state.supported) throw new Error('La impresión requiere la aplicación Android.')
    if (!state.connected) throw new Error('No hay impresora conectada. El pedido está guardado; conecta una impresora para reimprimirlo.')
    await printBytes(buildGeneralReceipt(order))
    receiptNotice.value = `Ticket de la nota #${order.number} enviado a ${state.name || 'la impresora'}.`
  } catch (issue) {
    receiptNotice.value = `El pedido está guardado, pero no se pudo imprimir: ${issue.message || 'error de impresora'}`
    try { printerState.value = await getPrinterState() } catch { printerState.value = { ...printerState.value, connected: false } }
  }
}

function showReceiptPreview(order) {
  receiptPreviewNumber.value = order.number
  receiptPreviewText.value = receiptPreview(buildGeneralReceipt(order))
  receiptPreviewDialog.value = true
}

async function save() {
  if (!authState.value.user || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await auth.check()
    if (!authState.value.user) throw new Error('La autorización ha vencido.')
    let value = { ...form.value, id: editing.value?.id }
    if (tab.value === 'products') {
      value.number = value.number || nextInternalNumber('products')
      value.priceCents = parseMoney(value.price)
      if (!String(value.cost ?? '').trim()) throw new Error('El costo del producto es obligatorio')
      value.costCents = parseMoney(value.cost)
    }
    if (tab.value === 'customers') {
      value.number = value.number || nextInternalNumber('customers')
      delete value.location
      delete value.route
      delete value.visitDays
    }
    if (tab.value === 'orders') {
      if (editing.value?.cutId && records.cuts.find((cut) => cut.id === editing.value.cutId)?.status === 'closed') throw new Error('Los pedidos de un corte cerrado no se pueden modificar.')
      if (!editing.value && !openCut.value) throw new Error('Abre un corte antes de registrar una venta.')
      const customer = records.customers.find((item) => item.id === value.customerId) || (editing.value?.customer.id === value.customerId ? editing.value.customer : null)
      if (!customer) throw new Error('Selecciona un cliente')
      value.customer = customer
      value.products = value.products.map((item) => {
        const catalogProduct = records.products.find((product) => product.id === item.id)
        return { ...item, costCents: item.costCents ?? catalogProduct?.costCents ?? null, quantity: Number(item.quantity) }
      })
      value.changes = value.changes.map((item) => ({ ...item, quantity: Number(item.quantity) }))
      value.createdAt = value.createdAt || new Date().toISOString()
      if (!editing.value) value.cutId = openCut.value.id
      const usedNumbers = new Set(records.orders.filter((item) => item.id !== value.id).map((item) => Number(item.number)).filter(Number.isInteger))
      if (!editing.value) {
        let candidate = 1
        while (usedNumbers.has(candidate)) candidate += 1
        value.number = String(candidate)
      }
    }
    const savedRecord = await repository.put(authState.value.user.id, tab.value, value)
    dialog.value = false
    await loadRecords()
    if (tab.value === 'orders') await printOrder(savedRecord)
  } catch (issue) { error.value = issue.message?.includes('constraint') || issue.message?.includes('UNIQUE') ? 'Ya existe un registro con ese número.' : issue.message || 'No se pudo guardar.' }
  finally { busy.value = false }
}

async function remove(item) {
  const recordName = item.name || item.customer?.name || 'este registro'
  if (!window.confirm(`¿Eliminar ${singular[tab.value]} ${recordName}?`)) return
  try {
    if (tab.value === 'orders' && item.cutId && records.cuts.find((cut) => cut.id === item.cutId)?.status === 'closed') throw new Error('Los pedidos de un corte cerrado no se pueden eliminar.')
    await auth.check()
    if (!authState.value.user) return
    await repository.remove(authState.value.user.id, tab.value, item.id)
    await loadRecords()
  }
  catch { error.value = 'No se pudo eliminar el registro.' }
}

function cutSummary(cut) {
  return cut.status === 'closed' ? cut : summarizeCut(records.orders, cut.id)
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function startCut() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await auth.check()
    if (!authState.value.user) throw new Error('La autorización ha vencido.')
    if (openCut.value) throw new Error('Ya hay un corte abierto.')
    await repository.put(authState.value.user.id, 'cuts', {
      number: nextInternalNumber('cuts'),
      status: 'open',
      openedAt: new Date().toISOString(),
    })
    await loadRecords()
  } catch (issue) { error.value = issue.message || 'No se pudo abrir el corte.' }
  finally { busy.value = false }
}

async function finishCut(cut) {
  if (busy.value || cut.status !== 'open') return
  if (!window.confirm('¿Cerrar este corte? Las ventas incluidas quedarán bloqueadas para edición.')) return
  busy.value = true
  error.value = ''
  try {
    await auth.check()
    if (!authState.value.user) throw new Error('La autorización ha vencido.')
    const summary = summarizeCut(records.orders, cut.id)
    await repository.put(authState.value.user.id, 'cuts', {
      ...cut,
      status: 'closed',
      closedAt: new Date().toISOString(),
      ...summary,
    })
    await loadRecords()
  } catch (issue) { error.value = issue.message || 'No se pudo cerrar el corte.' }
  finally { busy.value = false }
}

async function refresh() { if (auth) await auth.refresh() }
function online() { refresh() }
function visibility() { if (document.visibilityState === 'visible' && auth) { auth.check(); refresh() } }

onMounted(async () => {
  try {
    printerState.value = await getPrinterState()
    printerListeners = await Promise.all([
      listenPrinterEvent('deviceFound', addPrinter),
      listenPrinterEvent('scanFinished', () => { scanningPrinter.value = false }),
      listenPrinterEvent('connectionChanged', (state) => { printerState.value = { supported: true, ...state } }),
      listenPrinterEvent('scanError', (event) => { scanningPrinter.value = false; printerError.value = event.message || 'Error durante la búsqueda.' }),
    ])
  } catch (issue) {
    printerState.value = { supported: false, connected: false, name: null, address: null }
    printerError.value = issue.message || 'Bluetooth no está disponible.'
  }
  try {
    repository = await createRepository()
    const base = apiBase(import.meta.env.VITE_API_URL)
    const publicKey = import.meta.env.VITE_OFFLINE_PUBLIC_KEY
    await validateOfflinePublicKey(publicKey)
    auth = createAuth({ apiUrl: base, publicKey, storage: sessionStorage(), deviceIdentity: () => import('./auth/device-identity.js').then(({ getDeviceIdentity }) => getDeviceIdentity()), onChange: (value) => {
      authState.value = value
      clearTimeout(expiryTimer)
      if (value.status === 'ready') expiryTimer = setTimeout(() => auth.check(), Math.max(0, value.validUntil - Date.now()))
    } })
    authState.value = auth.getState()
    await auth.start()
    checkTimer = setInterval(() => auth.check(), 30000)
    renewTimer = setInterval(refresh, 15 * 60 * 1000)
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visibility)
  } catch (issue) { authState.value = { status: 'config', message: issue.message, user: null } }
})
onUnmounted(() => {
  clearInterval(checkTimer)
  clearInterval(renewTimer)
  clearTimeout(expiryTimer)
  window.removeEventListener('online', online)
  document.removeEventListener('visibilitychange', visibility)
  stopPrinterScan().catch(() => {})
  printerListeners.forEach((listener) => listener.remove())
})
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar class="toolbar">
        <q-icon name="storefront" size="25px" />
        <q-toolbar-title class="brand">Miniventa General</q-toolbar-title>
        <q-badge :color="printerState.connected ? 'positive' : 'grey-7'" text-color="white" :label="printerState.connected ? 'Imp. conectada' : printerState.supported ? 'Imp. desconectada' : 'Sin Bluetooth'" />
        <template v-if="authState.user">
          <q-btn flat round dense icon="sync" aria-label="Verificar conexión" @click="refresh"><q-tooltip>Verificar conexión</q-tooltip></q-btn>
          <q-btn flat round dense icon="logout" aria-label="Cerrar sesión" @click="auth.logout()"><q-tooltip>Cerrar sesión</q-tooltip></q-btn>
        </template>
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page class="page">
        <div v-if="authState.status === 'loading'" class="center-message"><q-spinner color="primary" size="32px" /></div>
        <div v-else-if="authState.status === 'config'" class="access-panel"><q-icon name="error_outline" color="negative" size="32px" /><h1>Configuración necesaria</h1><p role="alert">{{ authState.message }}</p></div>
        <div v-else-if="authState.status === 'login'" class="access-panel">
          <div class="eyebrow">TU NEGOCIO, EN ORDEN</div><h1>Iniciar sesión</h1><p class="muted">Accede a tu espacio de trabajo.</p>
          <q-form class="form-stack" @submit="login">
            <q-input v-model="credentials.username" outlined label="Usuario" autocomplete="username" maxlength="254" required />
            <q-input v-model="credentials.password" outlined label="Contraseña" type="password" autocomplete="current-password" required />
            <div v-if="authState.message || error" class="notice error" role="alert">{{ error || authState.message }}</div>
            <q-btn type="submit" color="primary" unelevated label="Entrar" :loading="busy" class="primary-action" />
          </q-form>
        </div>
        <div v-else-if="authState.status === 'blocked'" class="access-panel">
          <q-icon name="cloud_off" color="warning" size="34px" /><h1>Acceso no disponible</h1><p role="alert">{{ authState.message }}</p>
          <div class="row q-gutter-sm"><q-btn color="primary" unelevated label="Reintentar" @click="refresh" /><q-btn flat label="Cerrar sesión" @click="auth.logout()" /></div>
        </div>
        <div v-else-if="authState.status === 'devicePending'" class="access-panel">
          <q-icon name="pending_actions" color="warning" size="34px" /><h1>Cambio solicitado</h1>
          <p role="status">{{ authState.message }}</p>
          <p class="muted">Comparte este folio con el administrador: <strong>{{ authState.requestId }}</strong></p>
          <q-btn flat label="Volver al inicio de sesión" @click="auth.logout()" />
        </div>
        <div v-else class="workspace">
          <div class="workspace-top"><div><div class="eyebrow">ESPACIO DE TRABAJO</div><h1>{{ tab === 'printer' ? 'Impresora' : titles[tab] }}</h1><p class="muted greeting">{{ tab === 'printer' ? 'Conexión Bluetooth' : authState.user.name }}</p></div><q-btn v-if="tab !== 'printer' && tab !== 'cuts'" color="primary" unelevated icon="add" :label="`Nuevo ${singular[tab]}`" :disable="tab === 'orders' && !openCut" @click="openEditor()" /></div>
          <div v-if="authState.message" class="notice" role="status">{{ authState.message }}</div>
          <q-tabs v-model="tab" align="left" active-color="primary" indicator-color="primary" class="workspace-tabs" dense><q-tab name="orders" icon="receipt_long" label="Pedidos" /><q-tab name="products" icon="inventory_2" label="Productos" /><q-tab name="customers" icon="people" label="Clientes" /><q-tab name="cuts" icon="point_of_sale" label="Cortes" /><q-tab name="printer" icon="print" label="Impresora" /></q-tabs>
          <div v-if="error && !dialog" class="notice error" role="alert">{{ error }}</div>
          <div v-if="tab === 'orders' && receiptNotice" class="notice" role="status">{{ receiptNotice }}</div>
          <section v-if="tab === 'printer'" class="printer-view">
            <div class="printer-connection" :class="{ connected: printerState.connected }"><q-icon :name="printerState.connected ? 'print' : 'print_disabled'" size="30px" /><div><strong>{{ printerState.connected ? printerState.name || 'Impresora conectada' : 'Sin impresora conectada' }}</strong><div class="record-detail">{{ printerState.connected ? 'Bluetooth clásico · SPP' : 'Busca una impresora Bluetooth cercana' }}</div></div><q-btn v-if="printerState.connected" flat color="negative" label="Desconectar" @click="disconnectFromPrinter" /></div>
            <div v-if="!printerState.supported" class="notice">La búsqueda Bluetooth está disponible en la aplicación Android.</div>
            <template v-else>
              <div class="printer-actions"><div><h2>Dispositivos</h2><p class="muted">Las impresoras deben estar emparejadas y admitir Bluetooth clásico SPP.</p></div><q-btn color="primary" unelevated :icon="scanningPrinter ? 'search' : 'bluetooth_searching'" :label="scanningPrinter ? 'Buscando…' : 'Buscar impresoras'" :loading="scanningPrinter" @click="searchPrinters" /></div>
              <div v-if="printerError" class="notice error" role="alert">{{ printerError }}</div>
              <div v-if="!printerDevices.length" class="empty-state printer-empty"><q-icon name="bluetooth_searching" size="30px" /><strong>{{ scanningPrinter ? 'Buscando dispositivos…' : 'No hay impresoras en la lista' }}</strong><span>Empareja la impresora desde los ajustes Bluetooth del teléfono si no aparece.</span></div>
              <div v-else class="records-list"><article v-for="device in printerDevices" :key="device.address" class="record-row"><div class="record-main"><strong>{{ device.name }}</strong><div class="record-detail">{{ device.paired ? 'Emparejada' : 'Detectada' }}</div></div><q-btn color="primary" outline :label="printerState.address === device.address && printerState.connected ? 'Conectada' : 'Conectar'" :disable="printerBusy || (printerState.address === device.address && printerState.connected)" :loading="printerBusy && printerState.address === device.address" @click="connectToPrinter(device)" /></article></div>
            </template>
          </section>
          <section v-if="tab === 'cuts'" class="cuts-panel">
            <div v-if="openCut" class="cut-live-summary">
              <div class="cut-state"><span class="state-indicator"></span><div><strong>Corte #{{ openCut.number }} abierto</strong><small>Desde {{ formatDateTime(openCut.openedAt) }}</small></div></div>
              <div class="cut-metrics"><div><span>VENTAS</span><strong>{{ formatMoney(cutSummary(openCut).salesCents) }}</strong></div><div><span>GANANCIA</span><strong v-if="cutSummary(openCut).profitCents !== null">{{ formatMoney(cutSummary(openCut).profitCents) }}</strong><strong v-else class="missing-cost">Costo pendiente</strong></div><div><span>PEDIDOS</span><strong>{{ cutSummary(openCut).orderCount }}</strong></div></div>
              <p v-if="cutSummary(openCut).missingCostLines" class="muted">Falta registrar el costo de {{ cutSummary(openCut).missingCostLines }} línea(s) vendida(s); actualiza el producto y registra una venta nueva para que su margen se incluya.</p>
              <q-btn color="negative" outline icon="lock" label="Cerrar corte" :loading="busy" @click="finishCut(openCut)" />
            </div>
            <div v-else class="cut-start-row"><div><strong>No hay un corte abierto</strong><p class="muted">Abre un corte para empezar a registrar ventas.</p></div><q-btn color="primary" unelevated icon="lock_open" label="Abrir corte" :loading="busy" @click="startCut" /></div>
            <div class="cut-history-heading"><h2>Historial de cortes</h2><span>{{ records.cuts.length }} cortes</span></div>
            <div v-if="!sortedCuts.length" class="empty-state"><q-icon name="point_of_sale" size="30px" /><strong>Aún no hay cortes</strong></div>
            <div v-else class="records-list"><article v-for="cut in sortedCuts" :key="cut.id" class="record-row cut-row"><div class="record-main"><div class="record-number">Corte #{{ cut.number }} · {{ cut.status === 'open' ? 'Abierto' : 'Cerrado' }}</div><strong>{{ formatDateTime(cut.openedAt) }}</strong><div v-if="cut.closedAt" class="record-detail">Cerrado {{ formatDateTime(cut.closedAt) }} · {{ cut.orderCount }} pedidos</div></div><div v-if="cut.status === 'closed'" class="cut-row-totals"><span>Ventas <strong>{{ formatMoney(cut.salesCents) }}</strong></span><span>Ganancia <strong v-if="cut.profitCents !== null">{{ formatMoney(cut.profitCents) }}</strong><strong v-else class="missing-cost">Pendiente</strong></span></div><span v-else class="state-pill state-open">En curso</span></article></div>
          </section>
          <template v-else>
          <q-select v-if="tab === 'orders'" v-model="customerFilter" class="customer-filter" outlined dense clearable label="Filtrar por cliente" :options="customerOptions" emit-value map-options />
          <div v-if="tab === 'orders' && !openCut" class="notice">Abre un corte para poder registrar ventas.</div>
          <div v-if="tab === 'orders' && openCut" class="notice cut-inline-status">Corte #{{ openCut.number }} abierto · {{ formatMoney(cutSummary(openCut).salesCents) }} vendido</div>
          <div class="list-heading"><span>{{ titles[tab] }}</span><span>{{ visibleRecords.length }}{{ tab === 'orders' && customerFilter ? ` de ${records.orders.length}` : '' }} registros</span></div>
          <div v-if="!visibleRecords.length" class="empty-state"><q-icon :name="tab === 'orders' ? 'receipt_long' : tab === 'products' ? 'inventory_2' : 'people_outline'" size="30px" /><strong>{{ tab === 'orders' && customerFilter ? 'No hay pedidos de este cliente' : `Aún no hay ${titles[tab].toLowerCase()}` }}</strong></div>
          <div v-else class="records-list"><article v-for="item in visibleRecords" :key="item.id" class="record-row">
            <div class="record-main"><div v-if="tab === 'orders'" class="record-number">Folio #{{ item.number }}{{ item.cutId && records.cuts.find((cut) => cut.id === item.cutId)?.status === 'closed' ? ' · Corte cerrado' : '' }}</div><strong>{{ tab === 'orders' ? item.customer.name : item.name }}</strong><div v-if="tab === 'orders'" class="record-detail">{{ item.products.length }} productos</div><div v-if="tab === 'products'" class="record-detail">Costo {{ item.costCents == null ? 'pendiente' : formatMoney(item.costCents) }} · Ganancia {{ item.costCents == null ? 'pendiente' : formatMoney(item.priceCents - item.costCents) }}</div></div>
            <div v-if="tab === 'products' || tab === 'orders'" class="record-amount">{{ formatMoney(tab === 'products' ? item.priceCents : item.totalCents) }}</div>
            <q-btn v-if="tab === 'orders'" flat round dense icon="visibility" aria-label="Ver ticket" @click="showReceiptPreview(item)"><q-tooltip>Ver ticket</q-tooltip></q-btn><q-btn v-if="tab === 'orders'" flat round dense icon="print" aria-label="Reimprimir ticket" @click="printOrder(item)"><q-tooltip>Reimprimir ticket</q-tooltip></q-btn><q-btn v-if="!(tab === 'orders' && item.cutId && records.cuts.find((cut) => cut.id === item.cutId)?.status === 'closed')" flat round dense icon="edit" aria-label="Editar" @click="openEditor(item)"><q-tooltip>Editar</q-tooltip></q-btn><q-btn v-if="!(tab === 'orders' && item.cutId && records.cuts.find((cut) => cut.id === item.cutId)?.status === 'closed')" flat round dense icon="delete_outline" aria-label="Eliminar" @click="remove(item)"><q-tooltip>Eliminar</q-tooltip></q-btn>
          </article></div>
          <div v-if="tab === 'orders'" class="print-note"><q-icon name="print" size="18px" /> Configura la impresora en su apartado</div>
          </template>
        </div>
      </q-page>
    </q-page-container>
    <q-dialog v-model="dialog" persistent><q-card class="editor-card">
      <q-card-section class="editor-header"><div><div class="eyebrow">{{ editing ? 'EDITAR' : 'NUEVO' }}</div><h2>{{ singular[tab] }}</h2></div><q-btn flat round dense icon="close" aria-label="Cerrar" @click="dialog = false" /></q-card-section>
      <q-card-section class="editor-body"><q-form id="record-form" class="form-stack" @submit="save">
        <template v-if="tab === 'products'"><q-input v-model="form.name" outlined label="Nombre" maxlength="150" required /><q-input v-model="form.price" outlined label="Precio de venta" inputmode="decimal" required /><q-input v-model="form.cost" outlined label="Precio de costo" inputmode="decimal" required /></template>
        <template v-if="tab === 'customers'"><q-input v-model="form.name" outlined label="Nombre del cliente" maxlength="150" required /></template>
        <template v-if="tab === 'orders'">
          <q-select v-model="form.customerId" outlined label="Cliente" :options="customerOptions" emit-value map-options />
          <section class="order-section">
            <div class="order-section-heading"><h3>Productos de venta</h3><span>{{ form.products.length }} líneas</span></div>
            <q-select v-model="form.productId" outlined use-input input-debounce="0" clearable label="Buscar producto por nombre" :options="filteredProductOptions" emit-value map-options @filter="filterProducts" @update:model-value="addProduct('products', $event)">
              <template #option="scope"><q-item v-bind="scope.itemProps"><q-item-section><q-item-label>{{ scope.opt.label }}</q-item-label><q-item-label caption>{{ formatMoney(scope.opt.priceCents) }} por unidad</q-item-label></q-item-section></q-item></template>
            </q-select>
          <div v-for="(item, index) in form.products" :key="item.id" class="order-line"><div><strong>{{ item.name }}</strong><div class="record-detail">Venta {{ formatMoney(item.priceCents) }} · Costo {{ item.costCents == null ? 'pendiente' : formatMoney(item.costCents) }}</div></div><q-input v-model.number="item.quantity" outlined dense type="number" min="1" step="1" class="quantity" aria-label="Cantidad" /><q-btn flat round dense icon="close" aria-label="Quitar producto" @click="form.products.splice(index, 1)" /></div>
          </section>
          <section class="order-section">
            <div class="order-section-heading"><h3>Productos de cambio</h3><span>{{ form.changes.length }} líneas</span></div>
            <q-select v-model="form.changeId" outlined use-input input-debounce="0" clearable label="Buscar producto de cambio por nombre" :options="filteredProductOptions" emit-value map-options @filter="filterProducts" @update:model-value="addProduct('changes', $event)">
              <template #option="scope"><q-item v-bind="scope.itemProps"><q-item-section><q-item-label>{{ scope.opt.label }}</q-item-label><q-item-label caption>{{ formatMoney(scope.opt.priceCents) }} por unidad</q-item-label></q-item-section></q-item></template>
            </q-select>
          <div v-for="(item, index) in form.changes" :key="item.id" class="order-line"><div><strong>{{ item.name }}</strong><div class="record-detail">{{ formatMoney(item.priceCents) }} por unidad</div></div><q-input v-model.number="item.quantity" outlined dense type="number" min="1" step="1" class="quantity" aria-label="Cantidad de cambio" /><q-btn flat round dense icon="close" aria-label="Quitar producto de cambio" @click="form.changes.splice(index, 1)" /></div>
          </section>
          <div class="order-total"><span>Total</span><strong>{{ total }}</strong></div>
        </template><div v-if="error" class="notice error" role="alert">{{ error }}</div>
      </q-form></q-card-section>
      <q-card-actions align="right" class="editor-actions"><q-btn flat label="Cancelar" @click="dialog = false" /><q-btn type="submit" form="record-form" color="primary" unelevated label="Guardar" :loading="busy" /></q-card-actions>
    </q-card></q-dialog>
    <q-dialog v-model="receiptPreviewDialog"><q-card class="receipt-preview-card">
      <q-card-section class="editor-header"><div><div class="eyebrow">VISTA PREVIA</div><h2>Ticket #{{ receiptPreviewNumber }}</h2></div><q-btn flat round dense icon="close" aria-label="Cerrar vista previa" @click="receiptPreviewDialog = false" /></q-card-section>
      <q-card-section class="receipt-preview-body"><pre class="receipt-paper">{{ receiptPreviewText }}</pre></q-card-section>
      <q-card-actions align="right" class="editor-actions"><q-btn flat label="Cerrar" @click="receiptPreviewDialog = false" /></q-card-actions>
    </q-card></q-dialog>
  </q-layout>
</template>
