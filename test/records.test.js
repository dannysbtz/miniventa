import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRecord } from '../src/domain/records.js'
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