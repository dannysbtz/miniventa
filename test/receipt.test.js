import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGeneralReceipt, buildReceipt, receiptPreview } from '../src/printer/receipt.js'

const sample = {
  number: 'N-104',
  cedis: '7656',
  promoterNumber: '37669',
  route: { code: '4016', name: 'Ruta Centro' },
  createdAt: '2026-01-02T12:00:00Z',
  promoter: 'JESUS ISRAEL MENDOZA LOPEZ',
  customer: { number: 'C-22', name: 'Minisuper Patty', location: 'Revolución 1910 182', route: { id: 'r1', code: '4016', name: 'Centro' }, visitDays: ['L', 'Mi', 'V'] },
  products: [
    { number: '0012', name: 'Café molido', priceCents: 1250, quantity: 2 },
    { number: '0023', name: 'Azúcar', priceCents: 500, quantity: 1 },
  ],
  changes: [{ name: 'Taza azul', priceCents: 800, quantity: 1 }],
  totalCents: 3000,
}

test('ticket general muestra CEDIS, promotor, cliente, cantidades e importe total sin contenido de marca anterior', () => {
  const preview = receiptPreview(buildGeneralReceipt(sample, new Date('2026-01-02T12:00:00Z')))
  assert.match(preview, /MINIVENTA/)
  assert.match(preview, /Folio: N-104/)
  assert.match(preview, /Cliente: Minisuper Patty/)
  assert.match(preview, /2 x Cafe molido/)
  assert.match(preview, /\$12\.50 c\/u\s+\$25\.00/)
  assert.match(preview, /TOTAL\s+\$30\.00/)
  assert.doesNotMatch(preview, /AUTOVENTA|Comercializadora|CAMBIO FISICO|DESCUENTOS|Lala|Ruta Preventa|CEDIS|Promotor/)
})

test('genera ticket ESC/POS con venta, cambios informativos y total', () => {
  const bytes = buildReceipt(sample, new Date('2026-01-02T12:00:00Z'))
  const previewText = receiptPreview(bytes)
  const preview = previewText.replace(/\s+/g, ' ')
  assert.ok(bytes instanceof Uint8Array)
  assert.ok(bytes.length > 0)
  assert.ok(previewText.includes('\n'), 'la vista previa conserva los saltos de línea del ticket')
  assert.ok(previewText.includes('\n\n'), 'la vista previa conserva los espacios entre bloques')
  assert.match(preview, /AUTOVENTA/)
  assert.match(preview, /Comercializadora de Lacteos y Derivado/)
  assert.match(preview, /Calzada Carlos Herrera Arauz 185/)
  assert.match(preview, /Parque Industrial Carlos A\. Herrera Arauz/)
  assert.match(preview, /Gomez Palacio Gomez Palacio/)
  assert.match(preview, /Cedis# 7656 Promotor# 37669/)
  assert.match(preview, /Ruta Preventa #4016/)
  assert.match(preview, /Ruta Entrega #4016/)
  assert.match(preview, /Fecha de Pedido: 02\/01\/2026/)
  assert.match(preview, /Promotor: JESUS ISRAEL MENDOZA LOPEZ/)
  assert.match(preview, /Folio: #7656-0000104/)
  assert.match(preview, /Cliente: C-22/)
  assert.match(preview, /C-22/)
  assert.match(previewText, /\n\*\*\*\* PAGO CONTADO \*\*\*\n/)
  assert.match(previewText, /\n\*\*\*\* PAGO CONTADO \*\*\*\n\n\*\*\*\*\*\* ORIGINAL/)
  assert.match(previewText, /\n\*\*\*\*\*\* ORIGINAL \*\*\*\*\*\n/)
  assert.match(preview, /Minisuper Patty/)
  assert.match(preview, /Revolucion 1910 182/)
  assert.match(preview, /Centro/)
  assert.match(preview, /Dias de Visita L,Mi,V/)
  assert.match(preview, /Pedido para el Dia 02\/01\/2026/)
  assert.match(preview, /DESCRIPCION NO\. CLAVE\s+CANT\s+PRECIO\s+IMPORTE/)
  assert.match(preview, /Cafe molido 1 0012\s+2\s+\$12\.50\s+\$25\.00/)
  assert.match(preview, /Azucar 2 0023\s+1\s+\$5\.00\s+\$5\.00/)
  assert.match(preview, /Subtotal\s+\$30\.00/)
  assert.match(preview, /Descuento\s+\$0\.00/)
  assert.match(preview, /IVA\s+\$0\.00/)
  assert.match(preview, /TOTAL A PAGAR\s+\$30\.00/)
  assert.match(preview, /CAMBIO FISICO/)
  assert.match(preview, /Taza azul/)
  assert.match(preview, /Taza azul 00\s+1/)
  assert.match(preview, /DESCUENTOS/)
  const receiptLines = previewText.split('\n')
  for (const label of ['Cupones', 'Descuentos', 'Cupones Especiales']) {
    const line = receiptLines.find((candidate) => candidate.startsWith(`${label} 0`))
    assert.ok(line, `${label} incluye su renglón`)
    assert.ok(line.endsWith('$0.00'), `${label} alinea el importe al extremo derecho`)
    assert.equal(line.length, 42, `${label} usa todo el ancho del ticket`)
  }
  assert.match(preview, /Pidela a tu vendedor el NUEVO/)
  assert.match(preview, /Yoghurt batido 440gr, sabores fresa/)
  assert.match(preview, /y natural, es natural que te guste!/)
  assert.match(preview, /Los datos personales son tratados/)
  assert.match(preview, /http:\/\/www\.lala\.com\.mx/)
  assert.deepEqual([...bytes.slice(0, 3)], [27, 64, 27])
  assert.ok([...bytes].some((byte, index, array) => byte === 27 && array[index + 1] === 77 && array[index + 2] === 1), 'el cuerpo usa fuente B más pequeña')
  assert.ok([...bytes].some((byte, index, array) => byte === 27 && array[index + 1] === 51 && array[index + 2] === 21), 'usa avance de línea ligeramente mayor')
  assert.ok([...bytes].filter((byte, index, array) => byte === 29 && array[index + 1] === 33 && array[index + 2] === 16).length === 2, 'los dos rótulos comparten el mismo tamaño mayor')
  assert.ok(![...bytes].some((byte, index, array) => byte === 27 && array[index + 1] === 69 && array[index + 2] === 1), 'PAGO CONTADO y ORIGINAL no se imprimen en negrita')
  const rawText = new TextDecoder().decode(bytes)
  const totalStart = rawText.indexOf('TOTAL A PAGAR')
  const totalEnd = rawText.indexOf('\n', totalStart)
  assert.doesNotMatch(rawText.slice(totalStart, totalEnd), /\x1B(?:E\x01|!\x10)|\x1D!\x01/, 'el total no activa negrita ni tamaño grande')
  const decoded = rawText.replace(/\x1B(?:@|M[\s\S]|E[\s\S]|a[\s\S]|3[\s\S]|2)/g, '').replace(/\x1D(?:V[\s\S]{1,2}|![\s\S])/g, '')
  assert.equal(decoded.split('\n').filter((line) => /^\*{42}$/.test(line)).length, 2)
  const productLines = decoded.split('\n')
  assert.match(productLines[productLines.indexOf('Cafe molido') + 1], /^\s*1 0012\s+2\s+\$12\.50\s+\$25\.00\s*$/)
  assert.match(productLines[productLines.indexOf('Azucar') + 1], /^\s*2 0023\s+1\s+\$5\.00\s+\$5\.00\s*$/)
  assert.deepEqual([...bytes.slice(-3)], [29, 86, 1])
})
