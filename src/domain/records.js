import { orderTotal } from './money.js'

function text(value, label, max = 150) {
  const result = String(value ?? '').trim()
  if (!result || result.length > max) throw new Error(`${label} es obligatorio (máximo ${max} caracteres)`)
  return result
}

const VISIT_DAYS = ['L', 'M', 'Mi', 'J', 'V']

export function validateRecord(type, value) {
  if (type === 'routes') {
    const code = text(value.code || value.number, 'Código de ruta', 40)
    return { number: code, code, name: text(value.name, 'Nombre de ruta') }
  }
  if (type === 'settings') {
    return {
      number: 'business',
      cedis: text(value.cedis, 'CEDIS', 40),
      promoter: text(value.promoter, 'Promotor', 100),
    }
  }
  const number = text(value.number, 'Número', 40)
  if (type === 'products') {
    if (!Number.isSafeInteger(value.priceCents) || value.priceCents < 0) throw new Error('Precio inválido')
    return { number, name: text(value.name, 'Nombre'), priceCents: value.priceCents }
  }
  if (type === 'customers') {
    const visitDays = Array.isArray(value.visitDays) ? [...new Set(value.visitDays)] : []
    if (visitDays.some((day) => !VISIT_DAYS.includes(day))) throw new Error('Días de visita inválidos')
    const route = value.route ? { id: text(value.route.id, 'Ruta'), code: text(value.route.code, 'Código de ruta', 40), name: text(value.route.name, 'Ruta') } : null
    if (!route) throw new Error('Selecciona una ruta')
    return { number, name: text(value.name, 'Nombre'), location: text(value.location, 'Ubicación'), route, visitDays }
  }
  if (type === 'orders') {
    const customer = value.customer
    if (!customer?.id) throw new Error('Selecciona un cliente')
    if (!Array.isArray(value.products) || !value.products.length) throw new Error('Añade al menos un producto')
    const snapshot = (item) => {
      const result = { id: text(item?.id, 'Producto'), name: text(item?.name, 'Producto'), priceCents: item?.priceCents, quantity: item?.quantity }
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
    return { number, customer: customerSnapshot, products, changes, totalCents, createdAt, ...(promoter ? { promoter } : {}), ...(promoterNumber ? { promoterNumber } : {}), ...(cedis ? { cedis } : {}), ...(route ? { route } : {}) }
  }
  throw new Error('Tipo de registro inválido')
}