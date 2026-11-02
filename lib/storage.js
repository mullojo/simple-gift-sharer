export function createStore(factory = globalThis.indexedDB) {
  let opening
  async function db() {
    if (!factory) throw new Error('IndexedDB is unavailable. Enable local browser storage.')
    return opening ??= new Promise((resolve, reject) => {
      const r = factory.open('simple-gift-sharer', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('records', { keyPath: 'id' })
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = null }; resolve(r.result) }
      r.onerror = () => { opening = null; reject(r.error) }
      r.onblocked = () => { opening = null; reject(new Error('Close other sharer tabs to open storage.')) }
    })
  }
  async function run(mode, action) {
    const database = await db()
    return new Promise((resolve, reject) => {
      const tx = database.transaction('records', mode), request = action(tx.objectStore('records'))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(tx.error || new Error('Local storage failed. Keep your recovery file.'))
      tx.onerror = () => {}
    })
  }
  return { get: id => run('readonly', s => s.get(id)), list: () => run('readonly', s => s.getAll()), put: value => run('readwrite', s => s.put(value)) }
}
