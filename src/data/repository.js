import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { openDB } from 'idb'
import { validateRecord } from '../domain/records.js'

function validateProducts(products) {
  if (!Array.isArray(products)) throw new Error('Catálogo inválido')
  const validated = products.map((product) => validateRecord('products', product))
  if (new Set(validated.map((product) => product.number)).size !== validated.length) throw new Error('Catálogo con números duplicados')
  return validated
}

export async function createRepository() {
  if (Capacitor.isNativePlatform()) {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('CapacitorSQLite')) throw new Error('SQLite Android no disponible')
    const connection = new SQLiteConnection(CapacitorSQLite)
    const db = await connection.createConnection('miniventa', false, 'no-encryption', 1, false)
    await db.open()
    await db.execute('CREATE TABLE IF NOT EXISTS records (user_id TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL, number TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, type, id), UNIQUE (user_id, type, number));')
    return {
      async list(user, type) {
        const result = await db.query('SELECT id, data FROM records WHERE user_id = ? AND type = ? ORDER BY number', [user, type])
        return (result.values || []).map((row) => ({ ...JSON.parse(row.data), id: row.id }))
      },
      async put(user, type, value) {
        const data = validateRecord(type, value)
        const id = value.id || crypto.randomUUID()
        await db.run('INSERT INTO records (user_id, type, id, number, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, type, id) DO UPDATE SET number = excluded.number, data = excluded.data', [user, type, id, data.number, JSON.stringify(data)])
        return { ...data, id }
      },
      async mergeProducts(user, products) {
        const validated = validateProducts(products)
        if (!validated.length) return
        await db.executeSet(validated.map((data) => ({
          statement: 'INSERT INTO records (user_id, type, id, number, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, type, number) DO UPDATE SET data = excluded.data',
          values: [user, 'products', crypto.randomUUID(), data.number, JSON.stringify(data)],
        })), true)
      },
      async remove(user, type, id) { await db.run('DELETE FROM records WHERE user_id = ? AND type = ? AND id = ?', [user, type, id]) },
    }
  }
  const db = await openDB('miniventa', 1, {
    upgrade(database) {
      const store = database.createObjectStore('records', { keyPath: ['user', 'type', 'id'] })
      store.createIndex('byUserType', ['user', 'type'])
      store.createIndex('uniqueNumber', ['user', 'type', 'number'], { unique: true })
    },
  })
  return {
    async list(user, type) { return (await db.getAllFromIndex('records', 'byUserType', [user, type])).map(({ user: ignoredUser, type: ignoredType, ...value }) => value) },
    async put(user, type, value) {
      const data = validateRecord(type, value)
      const id = value.id || crypto.randomUUID()
      await db.put('records', { user, type, id, ...data })
      return { ...data, id }
    },
    async mergeProducts(user, products) {
      const validated = validateProducts(products)
      const transaction = db.transaction('records', 'readwrite')
      const store = transaction.objectStore('records')
      const index = store.index('uniqueNumber')
      for (const data of validated) {
        const existing = await index.get([user, 'products', data.number])
        await store.put({ user, type: 'products', id: existing?.id || crypto.randomUUID(), ...data })
      }
      await transaction.done
    },
    async remove(user, type, id) { await db.delete('records', [user, type, id]) },
  }
}