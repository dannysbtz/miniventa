import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { openDB } from 'idb'
import { validateRecord } from '../domain/records.js'

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
    async remove(user, type, id) { await db.delete('records', [user, type, id]) },
  }
}