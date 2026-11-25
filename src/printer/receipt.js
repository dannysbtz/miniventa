import { formatMoney } from '../domain/money.js'

const WIDTH = 42
const COLUMNS = { number: 2, key: 9, quantity: 4, price: 10, amount: 12 }
const COMPANY = [
  'Comercializadora de Lacteos y Derivado',
  'S. A. de C. V.',
  'Calzada Carlos Herrera Arauz 185',
  'Parque Industrial Carlos A. Herrera Arauz',
  'Gomez Palacio Gomez Palacio',
  'Tel. 871-229-3940',
]

function printerText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
}

function wrap(value, width = WIDTH) {
  const words = printerText(value).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    if (word.length > width) {
      if (line) lines.push(line)
      line = ''
      for (let index = 0; index < word.length; index += width) lines.push(word.slice(index, index + width))
      continue
    }
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}

function command(...bytes) {
  return bytes
}

export async function loadReceiptLogo(path = '/lala.jpeg', targetWidth = 220) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  const image = new Image()
  image.src = path
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = reject
  })
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * targetWidth / image.naturalWidth))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.fillStyle = '#fff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(image, 0, 0, targetWidth, targetHeight)
  const pixels = context.getImageData(0, 0, targetWidth, targetHeight).data
  const rowBytes = Math.ceil(targetWidth / 8)
  const raster = new Uint8Array(rowBytes * targetHeight)
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const offset = (y * targetWidth + x) * 4
      const luminance = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114
      if (luminance < 180) raster[y * rowBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8)
    }
  }
  return { raster, width: targetWidth, height: targetHeight }
}

export function buildReceipt(order, printedAt = new Date(), logo = null) {
  const bytes = []
  const text = (value) => { for (const line of wrap(value)) bytes.push(...new TextEncoder().encode(line), 10) }
  const fixedLine = (value) => {
    const line = printerText(value)
    bytes.push(...new TextEncoder().encode(line.length > WIDTH ? line.slice(0, WIDTH) : line.padEnd(WIDTH)), 10)
  }
  const rawLine = (value) => bytes.push(...new TextEncoder().encode(printerText(value)), 10)
  const rule = () => text('*'.repeat(WIDTH))
  const blank = () => bytes.push(10)
  const centered = (value) => {
    const line = printerText(value).slice(0, WIDTH)
    const left = Math.max(0, Math.floor((WIDTH - line.length) / 2))
    bytes.push(...new TextEncoder().encode(`${' '.repeat(left)}${line}`), 10)
  }
  const doubleLeft = (value) => {
    bytes.push(...command(29, 33, 16))
    const printable = value.includes('P A G O')
      ? '**** PAGO CONTADO ***'
      : '****** ORIGINAL *****'
    rawLine(printable)
    bytes.push(...command(29, 33, 0))
  }
  const money = (cents) => `$${formatMoney(cents)}`
  const tableRow = (lineNumber, quantity, item) => {
    const lineTotal = money(item.priceCents * quantity)
    const columns = [
      String(lineNumber).padStart(COLUMNS.number),
      String(item.number || '').slice(0, COLUMNS.key).padEnd(COLUMNS.key),
      String(quantity).padStart(COLUMNS.quantity),
      money(item.priceCents).padStart(COLUMNS.price),
      lineTotal.padStart(COLUMNS.amount),
    ]
    fixedLine(columns.join(' ').trimEnd())
  }
  const date = (value) => {
    const parts = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(value))
    const dateParts = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
    return `${dateParts.day}/${dateParts.month}/${dateParts.year}`
  }
  const rightAmount = (label, amount) => fixedLine(`${label}${money(amount).padStart(WIDTH - label.length)}`)
  const rightCountAmount = (label, count, amount) => {
    const prefix = `${label} ${count}`
    fixedLine(`${prefix}${money(amount).padStart(WIDTH - prefix.length)}`)
  }
  const subtotalCents = order.products.reduce((sum, item) => sum + item.priceCents * item.quantity, 0)
  const folioNumber = String(order.number || '1').replace(/\D/g, '').slice(-7).padStart(7, '0')

  bytes.push(...command(27, 64), ...command(27, 77, 1), ...command(27, 51, 21), ...command(27, 97, 0))
  if (logo?.raster && logo.width && logo.height) {
    const rowBytes = Math.ceil(logo.width / 8)
    bytes.push(...command(27, 97, 1), ...command(29, 118, 48, 0, rowBytes & 0xff, (rowBytes >> 8) & 0xff, logo.height & 0xff, (logo.height >> 8) & 0xff), ...logo.raster, ...command(27, 97, 0), 10)
  }
  text('AUTOVENTA')
  for (const line of COMPANY) text(line)
  blank()
  text(`Cedis# ${order.cedis || ''} Promotor# ${order.promoterNumber || order.promoter || ''}`.trim())
  text(`Ruta Preventa #${order.route?.code || ''}`.trim())
  text(`Ruta Entrega #${order.route?.code || ''}`.trim())
  blank()
  text(`Fecha de Pedido: ${date(order.createdAt || printedAt)}`)
  text(`Promotor: ${order.promoter || 'Prueba local'}`)
  text(`Cliente: ${order.customer.number || order.customer.name}`)
  text(`Folio: #${order.cedis || '0000'}-${folioNumber}`)
  blank()
  text(`Fecha impresion: ${date(printedAt)} ${printedAt.toLocaleTimeString('es-MX', { hour12: false })}`)
  blank()
  doubleLeft('* * * P A G O C O N T A D O * * *')
  blank()
  doubleLeft('* * * * * O R I G I N A L * * * * *')
  text(order.customer.name)
  if (order.customer.location) text(order.customer.location)
  if (order.customer.route?.name) text(order.customer.route.name)
  blank()
  text(`Dias de Visita ${(order.customer.visitDays || []).join(',')}`)
  text(`Pedido para el Dia ${date(order.deliveryDate || order.createdAt || printedAt)}`)
  blank()
  text('DESCRIPCION')
    fixedLine(`${'NO.'.padEnd(COLUMNS.number)} ${'CLAVE'.padEnd(COLUMNS.key)} ${'CANT'.padStart(COLUMNS.quantity)} ${'PRECIO'.padStart(COLUMNS.price)} ${'IMPORTE'.padStart(COLUMNS.amount)}`)
  for (const [index, item] of order.products.entries()) {
    text(item.name)
    tableRow(index + 1, item.quantity, item)
  }
  blank()
  rightAmount('Subtotal', subtotalCents)
  rightAmount('Descuento', order.discountCents || 0)
  rightAmount('IVA', order.taxCents || 0)
  rightAmount('TOTAL A PAGAR', order.totalCents)
  blank()
  text('CAMBIO FISICO')
  if (order.changes.length) {
    for (const item of order.changes) {
      text(item.name)
      fixedLine(`${'00'.padStart(COLUMNS.number)} ${String(item.number || '').slice(0, COLUMNS.key).padEnd(COLUMNS.key)} ${String(item.quantity).padStart(COLUMNS.quantity)} ${''.padStart(COLUMNS.price)} ${''.padStart(COLUMNS.amount)}`)
    }
  } else text('Sin cambios')
  blank()
  blank()
  text('DESCUENTOS')
  rightCountAmount('Cupones', 0, 0)
  rightCountAmount('Descuentos', 0, 0)
  rightCountAmount('Cupones Especiales', 0, 0)
  blank()
  blank()
  blank()
  rule()
  text('Pidela a tu vendedor el NUEVO')
  text('Yoghurt batido 440gr, sabores fresa')
  text('y natural, es natural que te guste!')
  rule()
  blank()
  text('Los datos personales son tratados')
  text('conforme a la Ley de Proteccion de')
  text('Datos. El aviso de privacidad puede')
  text('ser consultado en')
  text('http://www.lala.com.mx')
  bytes.push(...command(27, 50), 10, 10, 10, ...command(29, 86, 1))
  return Uint8Array.from(bytes)
}

export function buildGeneralReceipt(order, printedAt = new Date()) {
  const bytes = []
  const text = (value) => { for (const line of wrap(value)) bytes.push(...new TextEncoder().encode(line), 10) }
  const fixedLine = (value) => {
    const line = printerText(value)
    bytes.push(...new TextEncoder().encode(line.length > WIDTH ? line.slice(0, WIDTH) : line.padEnd(WIDTH)), 10)
  }
  const centered = (value) => {
    const line = printerText(value).slice(0, WIDTH)
    bytes.push(...new TextEncoder().encode(`${' '.repeat(Math.max(0, Math.floor((WIDTH - line.length) / 2)))}${line}`), 10)
  }
  const money = (cents) => `$${formatMoney(cents)}`
  const date = (value) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

  bytes.push(...command(27, 64), ...command(27, 77, 1), ...command(27, 51, 21), ...command(27, 97, 0))
  centered('MINIVENTA')
  centered('NOTA DE VENTA')
  text(`Folio: ${order.number || ''}`)
  text(`Fecha: ${date(order.createdAt || printedAt)}`)
  fixedLine('-'.repeat(WIDTH))
  text(`Cliente: ${order.customer.name}`)
  fixedLine('-'.repeat(WIDTH))
  for (const item of order.products) {
    text(`${item.quantity} x ${item.name}`)
    fixedLine(`${money(item.priceCents)} c/u${money(item.priceCents * item.quantity).padStart(WIDTH - money(item.priceCents).length - 6)}`)
  }
  fixedLine('-'.repeat(WIDTH))
  fixedLine(`TOTAL${money(order.totalCents).padStart(WIDTH - 5)}`)
  text('Gracias por su compra')
  bytes.push(...command(27, 50), 10, 10, 10, ...command(29, 86, 1))
  return Uint8Array.from(bytes)
}

export function receiptPreview(bytes) {
  return new TextDecoder().decode(bytes)
    .replace(/\x1B(?:@|M[\s\S]|E[\s\S]|a[\s\S]|3[\s\S]|2)/g, '')
    .replace(/\x1D(?:V[\s\S]{1,2}|![\s\S])/g, '')
    .replace(/\*{4} PAGO CONTADO \*{3}/g, '**** PAGO CONTADO ***')
    .replace(/\*{6} ORIGINAL \*{5}/g, '****** ORIGINAL *****')
    .replace(/\r/g, '')
    .replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, '')
    .split('\n').map((line) => line.replace(/\s+$/g, '')).join('\n')
    .trim()
}
