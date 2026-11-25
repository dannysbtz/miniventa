import { orderTotal } from './money.js'

function text(value, label, max = 150) {
  const result = String(value ?? '').trim()
  if (!result || result.length > max) throw new Error(`${label} es obligatorio (máximo ${max} caracteres)`)
  return result
}

const VISIT_DAYS = ['L', 'M', 'Mi', 'J', 'V']

export function validateRecord(type, value) {
  const number = type === 'settings' ? 'business' : type === 'receiptBranding' ? 'receipt-branding' : text(value.number, 'Número', 40)
  if (type === 'routes') {
    const code = text(value.code || value.number, 'Código de ruta', 40)
    return { number: code, code, name: text(value.name, 'Nombre de ruta') }
  }
  if (type === 'settings') {
    return {
      number,
      cedis: text(value.cedis, 'CEDIS', 40),
      promoter: text(value.promoter, 'Promotor', 100),
    }
  }
  if (type === 'receiptBranding') {
    const title = text(value.title, 'Texto del encabezado', 32)
    const logoDataUrl = String(value.logoDataUrl || '')
    if (logoDataUrl && (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z\d+/]+=*$/.test(logoDataUrl) || logoDataUrl.length > 100000)) {
      throw new Error('El logo debe ser una imagen válida de máximo 100 KB')
    }
    return { number, title, logoDataUrl }
  }
  if (type === 'cuts') {
    const status = value.status
    if (!['open', 'closed'].includes(status)) throw new Error('Estado de corte inválido')
    const openedAt = new Date(value.openedAt)
    if (Number.isNaN(openedAt.getTime())) throw new Error('Fecha de apertura inválida')
    if (status === 'open') return { number, status, openedAt: openedAt.toISOString() }
    const closedAt = new Date(value.closedAt)
    if (Number.isNaN(closedAt.getTime())) throw new Error('Fecha de cierre inválida')
    for (const field of ['orderCount', 'salesCents', 'missingCostLines']) {
      if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw new Error(`Resumen de corte inválido: ${field}`)
    }
    if (value.costCents !== null && (!Number.isSafeInteger(value.costCents) || value.costCents < 0)) throw new Error('Costo de corte inválido')
    if (value.profitCents !== null && !Number.isSafeInteger(value.profitCents)) throw new Error('Ganancia de corte inválida')
    return { number, status, openedAt: openedAt.toISOString(), closedAt: closedAt.toISOString(), orderCount: value.orderCount, salesCents: value.salesCents, costCents: value.costCents, profitCents: value.profitCents, missingCostLines: value.missingCostLines }
  }
  if (type === 'products') {
    if (!Number.isSafeInteger(value.priceCents) || value.priceCents < 0) throw new Error('Precio inválido')
    const costCents = value.costCents == null || value.costCents === '' ? null : value.costCents
    if (costCents !== null && (!Number.isSafeInteger(costCents) || costCents < 0)) throw new Error('Costo inválido')
    if (costCents !== null && costCents > value.priceCents) throw new Error('El costo no puede ser mayor que el precio de venta')
    return { number, name: text(value.name, 'Nombre'), priceCents: value.priceCents, costCents }
  }
  if (type === 'customers') {
    const visitDays = Array.isArray(value.visitDays) ? [...new Set(value.visitDays)] : []
    if (visitDays.some((day) => !VISIT_DAYS.includes(day))) throw new Error('Días de visita inválidos')
    const route = value.route ? { id: text(value.route.id, 'Ruta'), code: text(value.route.code, 'Código de ruta', 40), name: text(value.route.name, 'Ruta') } : undefined
    const location = value.location ? text(value.location, 'Ubicación') : undefined
    return { number, name: text(value.name, 'Nombre'), ...(location ? { location } : {}), ...(route ? { route } : {}), ...(visitDays.length ? { visitDays } : {}) }
  }
  if (type === 'orders') {
    const customer = value.customer
    if (!customer?.id) throw new Error('Selecciona un cliente')
    if (!Array.isArray(value.products) || !value.products.length) throw new Error('Añade al menos un producto')
    const snapshot = (item) => {
      const result = { id: text(item?.id, 'Producto'), name: text(item?.name, 'Producto'), priceCents: item?.priceCents, quantity: item?.quantity }
      if (item?.costCents != null) {
        if (!Number.isSafeInteger(item.costCents) || item.costCents < 0) throw new Error('Costo de producto inválido')
        result.costCents = item.costCents
      }
      if (item?.number) result.number = text(item.number, 'Número de producto', 40)
      return result
    }
    const products = value.products.map(snapshot)
    const totalCents = orderTotal(products)
    if (!Array.isArray(value.changes)) throw new Error('Cambios inválidos')
    const changes = value.changes.map(snapshot)
    orderTotal(changes)
    const customerSnapshot = { id: text(customer.id, 'Cliente'), name: text(customer.name, 'Cliente') }
    if (customer.number) customerSnapshot.number = text(customer.number, 'Número de cliente', 40)
    if (customer.location) customerSnapshot.location = text(customer.location, 'Ubicación')
    if (customer.route) customerSnapshot.route = { id: text(customer.route.id, 'Ruta'), code: text(customer.route.code, 'Código de ruta', 40), name: text(customer.route.name, 'Ruta') }
    if (Array.isArray(customer.visitDays)) customerSnapshot.visitDays = [...new Set(customer.visitDays)].filter((day) => VISIT_DAYS.includes(day))
    const createdAt = value.createdAt ? new Date(value.createdAt).toISOString() : new Date().toISOString()
    const promoter = value.promoter ? text(value.promoter, 'Promotor') : undefined
    const promoterNumber = value.promoterNumber ? text(value.promoterNumber, 'Número de promotor', 100) : undefined
    const cedis = value.cedis ? text(value.cedis, 'CEDIS', 40) : undefined
    const route = value.route ? { code: text(value.route.code, 'Código de ruta', 40), name: text(value.route.name, 'Ruta') } : undefined
    const cutId = value.cutId ? text(value.cutId, 'Corte', 100) : undefined
    return { number, customer: customerSnapshot, products, changes, totalCents, createdAt, ...(cutId ? { cutId } : {}), ...(promoter ? { promoter } : {}), ...(promoterNumber ? { promoterNumber } : {}), ...(cedis ? { cedis } : {}), ...(route ? { route } : {}) }
  }
  throw new Error('Tipo de registro inválido')
}