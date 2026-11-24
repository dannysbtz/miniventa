import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMoney, orderTotal, parseMoney } from '../src/domain/money.js'

test('importes y totales se calculan en centavos', () => {
  assert.equal(parseMoney('0.10') + parseMoney('0,20'), 30)
  assert.equal(orderTotal([{ priceCents: 10, quantity: 3 }, { priceCents: 20, quantity: 1 }]), 50)
  assert.equal(formatMoney(50), '0.50')
  for (const value of ['', '-1', '1.234', 'NaN', '999999999999999999999']) assert.throws(() => parseMoney(value))
  assert.throws(() => orderTotal([{ priceCents: 1, quantity: 0 }]))
})