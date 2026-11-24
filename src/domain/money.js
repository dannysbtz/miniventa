export function parseMoney(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) throw new Error('Introduce un importe válido con hasta dos decimales')
  const [whole, fraction = ''] = text.replace(',', '.').split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('Importe demasiado grande')
  return cents
}

export function formatMoney(cents) {
  if (!Number.isSafeInteger(cents)) throw new Error('Importe inválido')
  return (cents / 100).toFixed(2)
}

export function orderTotal(items) {
  const total = items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.priceCents) || item.priceCents < 0 || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error('Producto o cantidad inválidos')
    const next = sum + item.priceCents * item.quantity
    if (!Number.isSafeInteger(next)) throw new Error('Total demasiado grande')
    return next
  }, 0)
  return total
}