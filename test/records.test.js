import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRecord } from '../src/domain/records.js'
import { summarizeCut } from '../src/domain/cuts.js'
import { createRepository } from '../src/data/repository.js'

test('valida entidades y calcula total de pedido desde líneas', () => {
  assert.throws(() => validateRecord('products', { number: '1', name: '', priceCents: 2 }))
  assert.throws(() => validateRecord('customers', { number: '1', name: '' }))
  assert.throws(() => validateRecord('orders', { number: '1', customer: { id: '1', name: 'Ana' }, products: [], changes: [] }))
  const order = validateRecord('orders', { number: '1', customer: { id: '1', name: 'Ana' }, products: [{ id: '2', name: 'Pan', priceCents: 10, quantity: 3 }], changes: [], totalCents: 999 })
  assert.equal(order.totalCents, 30)
})

test('el perfil general permite clientes sin ubicación, ruta ni días de visita', () => {
  const customer = validateRecord('customers', { number: '1', name: 'Ana' })
  assert.deepEqual(customer, { number: '1', name: 'Ana' })
})

test('producto valida costo y pedido conserva el costo unitario como instantánea', () => {
  const product = validateRecord('products', { number: '1', name: 'Pan', priceCents: 500, costCents: 300 })
  assert.equal(product.costCents, 300)
  assert.throws(() => validateRecord('products', { number: '2', name: 'Pan', priceCents: 500, costCents: -1 }))
  assert.throws(() => validateRecord('products', { number: '3', name: 'Pan', priceCents: 300, costCents: 301 }), /mayor que el precio de venta/)
  assert.equal(validateRecord('products', { number: '4', name: 'Pan', priceCents: 300, costCents: 300 }).costCents, 300)
  const order = validateRecord('orders', { number: '1', customer: { id: 'c1', name: 'Ana' }, products: [{ id: 'p1', name: 'Pan', priceCents: 500, costCents: 300, quantity: 2 }], changes: [] })
  assert.equal(order.products[0].costCents, 300)
})

test('guarda branding del ticket por usuario y limita título/logo', async () => {
  const repository = await createRepository()
  const branding = await repository.put('branding-user', 'receiptBranding', {
    title: 'Tienda La Esquina',
    logoDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
  })
  const [saved] = await repository.list('branding-user', 'receiptBranding')
  assert.equal(saved.title, 'Tienda La Esquina')
  assert.equal(saved.logoDataUrl, branding.logoDataUrl)
  assert.equal((await repository.list('other-user', 'receiptBranding')).length, 0)
  assert.throws(() => validateRecord('receiptBranding', { title: 'x'.repeat(33), logoDataUrl: '' }))
  assert.throws(() => validateRecord('receiptBranding', { title: 'Tienda', logoDataUrl: 'not-an-image' }))
})

test('corte calcula venta y ganancia y avisa si faltan costos', () => {
  const orders = [
    { cutId: 'cut-1', totalCents: 1000, products: [{ costCents: 300, quantity: 2 }] },
    { cutId: 'cut-1', totalCents: 500, products: [{ costCents: 200, quantity: 1 }] },
    { cutId: 'cut-2', totalCents: 900, products: [{ costCents: 100, quantity: 1 }] },
  ]
  assert.deepEqual(summarizeCut(orders, 'cut-1'), { orderCount: 2, salesCents: 1500, costCents: 800, profitCents: 700, missingCostLines: 0 })
  orders[0].products[0].costCents = null
  assert.deepEqual(summarizeCut(orders, 'cut-1'), { orderCount: 2, salesCents: 1500, costCents: null, profitCents: null, missingCostLines: 1 })
})

test('corte abierto y resumen cerrado se guardan por usuario', async () => {
  const repository = await createRepository()
  const opened = await repository.put('cortes-user', 'cuts', { number: '1', status: 'open', openedAt: '2026-01-02T10:00:00.000Z' })
  await repository.put('cortes-user', 'cuts', { ...opened, status: 'closed', closedAt: '2026-01-02T12:00:00.000Z', orderCount: 2, salesCents: 1500, costCents: 800, profitCents: 700, missingCostLines: 0 })
  const [closed] = await repository.list('cortes-user', 'cuts')
  assert.equal(closed.status, 'closed')
  assert.equal(closed.salesCents, 1500)
  assert.equal(closed.profitCents, 700)
  assert.equal((await repository.list('another-user', 'cuts')).length, 0)
})

test('pedido guardado conserva su corte y aparece en venta y ganancia', async () => {
  const repository = await createRepository()
  const order = await repository.put('ventas-user', 'orders', {
    number: '1',
    cutId: 'cut-open',
    customer: { id: 'customer-1', name: 'Ana' },
    products: [{ id: 'product-1', name: 'Pan', priceCents: 500, costCents: 300, quantity: 2 }],
    changes: [],
  })
  assert.equal(order.cutId, 'cut-open')
  const savedOrders = await repository.list('ventas-user', 'orders')
  assert.deepEqual(summarizeCut(savedOrders, 'cut-open'), {
    orderCount: 1,
    salesCents: 1000,
    costCents: 600,
    profitCents: 400,
    missingCostLines: 0,
  })
})

test('cambios son instantáneas de productos validadas y no modifican el total', () => {
  const order = { number: '1', customer: { id: '1', name: 'Ana' }, products: [{ id: '2', name: 'Pan', priceCents: 10, quantity: 3 }], changes: [{ id: '3', name: 'Leche', priceCents: 200, quantity: 2 }] }
  const validated = validateRecord('orders', order)
  assert.equal(validated.totalCents, 30)
  assert.deepEqual(validated.changes, order.changes)
  for (const change of [{ at: new Date().toISOString(), action: 'editado' }, { ...order.changes[0], quantity: 0 }, { ...order.changes[0], quantity: 1.5 }, { ...order.changes[0], priceCents: -1 }, { ...order.changes[0], name: '' }]) {
    assert.throws(() => validateRecord('orders', { ...order, changes: [change] }))
  }
})

test('pedido conserva los datos de cliente y número de producto para el ticket', () => {
  const order = validateRecord('orders', {
    number: '1',
    createdAt: '2026-01-02T12:00:00.000Z',
    promoter: 'JESUS ISRAEL MENDOZA LOPEZ',
    customer: { id: 'c1', number: 'C-22', name: 'Ana', location: 'Revolución 1910 #182', route: { id: 'r1', code: '4016', name: 'Centro' }, visitDays: ['L', 'Mi', 'V'] },
    products: [{ id: 'p1', number: '0012', name: 'Pan', priceCents: 500, quantity: 2 }],
    changes: [],
  })
  assert.deepEqual(order.customer, { id: 'c1', number: 'C-22', name: 'Ana', location: 'Revolución 1910 #182', route: { id: 'r1', code: '4016', name: 'Centro' }, visitDays: ['L', 'Mi', 'V'] })
  assert.equal(order.products[0].number, '0012')
  assert.equal(order.createdAt, '2026-01-02T12:00:00.000Z')
  assert.equal(order.promoter, 'JESUS ISRAEL MENDOZA LOPEZ')
})

test('IndexedDB guarda y edita cambios sin depender del catálogo', async () => {
  const repository = await createRepository()
  const product = await repository.put('cambios', 'products', { number: '1', name: 'Leche', priceCents: 200 })
  const order = await repository.put('cambios', 'orders', { number: '1', customer: { id: '1', name: 'Ana' }, products: [{ id: '2', name: 'Pan', priceCents: 10, quantity: 3 }], changes: [{ id: product.id, name: product.name, priceCents: product.priceCents, quantity: 2 }] })
  await repository.put('cambios', 'products', { ...product, name: 'Nueva leche', priceCents: 500 })
  await repository.remove('cambios', 'products', product.id)
  const [stored] = await repository.list('cambios', 'orders')
  assert.deepEqual(stored.changes, order.changes)
  stored.changes[0].quantity = 4
  await repository.put('cambios', 'orders', stored)
  const [edited] = await repository.list('cambios', 'orders')
  assert.equal(edited.changes[0].quantity, 4)
  assert.equal(edited.totalCents, 30)
})

test('IndexedDB persiste, aísla usuarios, valida números únicos y permite editar y eliminar', async () => {
  const first = await createRepository()
  const product = await first.put('u1', 'products', { number: '42', name: 'Pan', priceCents: 123 })
  await first.put('u2', 'products', { number: '42', name: 'Otro', priceCents: 10 })
  await assert.rejects(first.put('u1', 'products', { number: '42', name: 'Duplicado', priceCents: 1 }))
  const second = await createRepository()
  assert.equal((await second.list('u1', 'products'))[0].name, 'Pan')
  assert.equal((await second.list('u2', 'products'))[0].name, 'Otro')
  await second.put('u1', 'products', { ...product, name: 'Pan nuevo' })
  assert.equal((await first.list('u1', 'products'))[0].name, 'Pan nuevo')
  await second.remove('u1', 'products', product.id)
  assert.equal((await first.list('u1', 'products')).length, 0)
  assert.equal((await first.list('u2', 'products')).length, 1)
})