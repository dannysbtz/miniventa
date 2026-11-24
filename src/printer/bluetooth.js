import { Capacitor, registerPlugin } from '@capacitor/core'

const BluetoothPrinter = registerPlugin('BluetoothPrinter')

export function bluetoothAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('BluetoothPrinter')
}

export async function getPrinterState() {
  if (!bluetoothAvailable()) return { supported: false, connected: false, name: null, address: null }
  return { supported: true, ...(await BluetoothPrinter.getState()) }
}

export async function getPairedPrinters() {
  if (!bluetoothAvailable()) throw new Error('La búsqueda Bluetooth está disponible en la aplicación Android.')
  const result = await BluetoothPrinter.getPairedDevices()
  return result.devices || []
}

export async function scanPrinters() {
  if (!bluetoothAvailable()) throw new Error('La búsqueda Bluetooth está disponible en la aplicación Android.')
  return BluetoothPrinter.startScan()
}

export async function stopPrinterScan() {
  if (bluetoothAvailable()) await BluetoothPrinter.stopScan()
}

export async function connectPrinter(address) {
  if (!bluetoothAvailable()) throw new Error('La conexión Bluetooth está disponible en la aplicación Android.')
  return BluetoothPrinter.connect({ address })
}

export async function disconnectPrinter() {
  if (bluetoothAvailable()) return BluetoothPrinter.disconnect()
  return { connected: false, name: null, address: null }
}

export async function printBytes(bytes) {
  if (!bluetoothAvailable()) throw new Error('La impresión Bluetooth está disponible en la aplicación Android.')
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return BluetoothPrinter.print({ data: btoa(binary) })
}

export function listenPrinterEvent(eventName, listener) {
  if (!bluetoothAvailable()) return Promise.resolve({ remove: async () => {} })
  return BluetoothPrinter.addListener(eventName, listener)
}
