import { validateShares, makePlan } from './math.js'
import { verifySignedPlan, transactionId } from './transaction.js'
import { mempool, NETWORKS, chooseFee } from './mempool.js'

const TXID = /^[a-f0-9]{64}$/
const clone = value => structuredClone(value)
export async function recipientScript(bitcoin, address, network) {
  if (!NETWORKS[network]) throw new Error('Unknown network.')
  address = String(address).trim()
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) throw new Error('Mixed-case Bitcoin address is invalid.')
  address = address.toLowerCase()
  if (!new RegExp(`^${NETWORKS[network].prefix}1[qp][a-z0-9]+$`).test(address)) throw new Error('Use a native SegWit (…1q) or Taproot (…1p) address on the selected network.')
  let script
  try { script = await bitcoin.script.getScriptByAddress(address) } catch { throw new Error('Address checksum is invalid.') }
  if (!/^(0014[0-9a-f]{40}|0020[0-9a-f]{64}|5120[0-9a-f]{64})$/.test(script)) throw new Error('Unsupported witness address.')
  return { address, script }
}

// SDK, storage, network API and locking are injected: this module owns no UI.
export function createSharer({ bitcoin, store, apiFactory = mempool, locks = globalThis.navigator?.locks }) {
  async function exclusive(id, action) {
    if (!locks?.request) throw new Error('This browser needs Web Locks support to coordinate safe signing across tabs. Use current Chrome, Edge, Firefox, or Safari on localhost/HTTPS.')
    return locks.request(`simple-gift-sharer:${id}`, action)
  }
  async function create(config) {
    if (!locks?.request) throw new Error('Web Locks are required. Open this app on localhost or HTTPS in a current browser.')
    if (!NETWORKS[config.network]) throw new Error('Choose a network.')
    if (!Number.isSafeInteger(config.expectedSats) || config.expectedSats < 1 || config.expectedSats > 100000000) throw new Error('Choose 1–100,000,000 sats.')
    if (!['economy', 'normal', 'priority'].includes(config.feePreference)) throw new Error('Choose a fee preference.')
    if (!Number.isFinite(config.maxFeeRate) || config.maxFeeRate < 1 || config.maxFeeRate > 1000) throw new Error('Fee ceiling must be 1–1,000 sat/vB.')
    if (!Number.isFinite(config.maxFeePercent) || config.maxFeePercent < 1 || config.maxFeePercent > 50) throw new Error('Fee budget must be 1–50%.')
    if (!['mempool', 'confirmed'].includes(config.fundingPolicy)) throw new Error('Choose when to share.')
    const recipients = await Promise.all(config.recipients.map(async r => ({ label: String(r.label || '').slice(0, 60), bps: r.bps, ...await recipientScript(bitcoin, r.address, config.network) })))
    validateShares(recipients)
    const keys = await bitcoin.wallet.generateKeyPair()
    const address = await bitcoin.address.generateAddress(keys.publicKey, 'segwit', NETWORKS[config.network].sdk)
    const fees = await apiFactory(config.network).fees()
    // Do not offer a QR for a request that cannot pay its minimum shares/fee.
    makePlan([{ txid: '0'.repeat(64), vout: 0, value: config.expectedSats }], recipients, chooseFee(fees, config.feePreference), config)
    const record = { id: crypto.randomUUID(), kind: 'gift', version: 1, createdAt: Date.now(), updatedAt: Date.now(), config: { ...clone(config), recipients }, address, publicKey: keys.publicKey, privateKey: keys.privateKey, state: 'waiting', current: null, history: [], confirmations: 0, notice: '', lastError: '', observedSats: 0 }
    await store.put(record) // Must commit before the caller can display the address.
    try { await globalThis.navigator?.storage?.persist?.() } catch {}
    return record
  }
  async function save(record) { record.updatedAt = Date.now(); await store.put(record); return record }
  async function funding(record, api) {
    const list = await api.utxos(record.address)
    if (!Array.isArray(list) || list.length > 100) throw new Error('Unexpected or excessive funding inputs. Recovery keys have been retained.')
    const result = list.map(u => {
      if (!TXID.test(u.txid) || !Number.isInteger(u.vout) || u.vout < 0 || !Number.isSafeInteger(u.value) || u.value <= 0) throw new Error('Invalid UTXO response.')
      return { txid: u.txid, vout: u.vout, value: u.value, confirmed: Boolean(u.status?.confirmed) }
    }).sort((a, b) => a.txid.localeCompare(b.txid) || a.vout - b.vout)
    if (new Set(result.map(u => `${u.txid}:${u.vout}`)).size !== result.length) throw new Error('Duplicate funding inputs.')
    return result
  }
  async function observedTransaction(api, txid) {
    try { return await api.tx(txid) } catch (error) { if (error.status === 404) return null; throw error }
  }
  async function tick(id) {
    return exclusive(id, async () => {
      const record = await store.get(id)
      if (!record || record.cleanedAt || record.paused) return record
      const api = apiFactory(record.config.network)
      try {
        record.lastError = ''
        if (record.current) {
          const tx = await observedTransaction(api, record.current.txid)
          if (tx) {
            if (tx.txid !== record.current.txid) throw new Error('Unexpected transaction response.')
            const tip = tx.status?.confirmed ? await api.tip() : 0
            if (tx.status?.confirmed && (!Number.isSafeInteger(tip) || !Number.isInteger(tx.status.block_height))) throw new Error('Invalid confirmation response.')
            record.confirmations = tx.status?.confirmed ? Math.max(0, tip - tx.status.block_height + 1) : 0
            record.state = record.confirmations >= 3 ? 'complete' : 'confirming'
            record.notice = record.confirmations >= 3 ? 'Shared. Keep the key, or clean up after checking for late deposits.' : 'Split transaction seen. Waiting for three confirmations.'
            if (record.confirmations >= 3) {
              record.observedSats = (await funding(record, api)).reduce((s, u) => s + u.value, 0)
              if (record.observedSats) record.notice = 'Additional funds remain at the temporary address. Keep the key and share the late funds.'
            }
            return await save(record)
          }
          // A timeout or dropped transaction must never result in a different automatic spend.
          const ownScript = await bitcoin.script.getScriptByAddress(record.address)
          for (const u of record.current.inputs) {
            const parent = await api.tx(u.txid), output = parent.vout?.[u.vout]
            if (parent.txid !== u.txid || output?.scriptpubkey !== ownScript || output.value !== u.value) throw new Error('Saved transaction funding verification failed. Key retained.')
          }
          const spends = await Promise.all(record.current.inputs.map(u => api.outspend(u.txid, u.vout)))
          if (spends.some(s => s.spent && s.txid !== record.current.txid)) throw new Error('A funding input was spent by a different transaction. Key retained; inspect the funding transaction before recovery.')
          record.confirmations = 0
          record.state = 'broadcasting'
          await save(record)
          const returnedId = (await api.broadcast(record.current.raw)).trim()
          if (returnedId !== record.current.txid) throw new Error('Broadcast returned an unexpected transaction ID. The saved transaction is retained.')
          record.state = 'confirming'
          record.notice = 'Split broadcast. Waiting for three confirmations.'
          return await save(record)
        }
        const utxos = await funding(record, api)
        record.observedSats = utxos.reduce((s, u) => s + u.value, 0)
        const eligible = record.config.fundingPolicy === 'confirmed' ? utxos.filter(u => u.confirmed) : utxos
        const amount = eligible.reduce((s, u) => s + u.value, 0)
        if (amount < record.config.expectedSats) {
          record.state = 'waiting'
          record.notice = record.observedSats >= record.config.expectedSats ? 'Funding seen; waiting for its first confirmation.' : `Waiting for at least ${record.config.expectedSats.toLocaleString()} sats.`
          return await save(record)
        }
        // Verify each input against its actual funding transaction before signing.
        const ownScript = await bitcoin.script.getScriptByAddress(record.address)
        const parents = new Map()
        for (const u of eligible) {
          if (!parents.has(u.txid)) parents.set(u.txid, await api.tx(u.txid))
          const parent = parents.get(u.txid), output = parent.vout?.[u.vout]
          if (parent.txid !== u.txid || output?.scriptpubkey !== ownScript || output.value !== u.value) throw new Error('Funding output verification failed.')
        }
        const feeRate = chooseFee(await api.fees(), record.config.feePreference)
        const plan = makePlan(eligible, record.config.recipients, feeRate, record.config)
        const tx = new bitcoin.Transaction()
        for (const input of plan.inputs) await tx.addInput({ txHash: input.txid, index: input.vout, value: input.value })
        for (const output of plan.outputs) await tx.addOutput({ address: output.address, value: output.value })
        for (let i = 0; i < plan.inputs.length; i++) await tx.signInput(record.privateKey, i)
        const raw = await tx.getSignedHex(), txid = await tx.getId()
        const actual = verifySignedPlan(raw, plan)
        if (!TXID.test(txid) || await transactionId(raw) !== txid) throw new Error('Signing returned an invalid transaction ID.')
        const currentUtxos = await funding(record, api)
        if (!plan.inputs.every(u => currentUtxos.some(v => v.txid === u.txid && v.vout === u.vout && v.value === u.value))) throw new Error('Funding changed before broadcast. Checking again shortly.')
        record.current = { ...plan, ...actual, txid, raw, signedAt: Date.now() }
        record.state = 'broadcasting'
        record.notice = 'Signed locally. Saved before broadcast.'
        await save(record) // Crash boundary: all retries use these exact bytes and this txid.
        const returnedId = (await api.broadcast(raw)).trim()
        if (returnedId !== txid) throw new Error('Broadcast response differed. Checking the saved transaction on the next poll.')
        record.state = 'confirming'
        record.notice = 'Split broadcast. Waiting for three confirmations.'
        return await save(record)
      } catch (error) {
        record.lastError = error.message || 'Network unavailable. Reopen this browser to resume.'
        return await save(record)
      }
    })
  }
  async function shareLateFunds(id) {
    return exclusive(id, async () => {
      const record = await store.get(id)
      if (!record?.privateKey || record.state !== 'complete') throw new Error('Complete the current split first.')
      const api = apiFactory(record.config.network)
      const tx = await api.tx(record.current.txid), tip = await api.tip()
      if (!tx.status?.confirmed || tip - tx.status.block_height + 1 < 3) throw new Error('Wait for three confirmations.')
      if (!(await funding(record, api)).length) throw new Error('No late funds to share.')
      record.history.push(record.current)
      record.current = null; record.confirmations = 0; record.state = 'waiting'
      // A smaller late deposit can be swept, provided all fee/dust limits still pass.
      record.config.expectedSats = 1
      return save(record)
    })
  }
  async function cleanup(id) {
    return exclusive(id, async () => {
      const record = await store.get(id)
      if (!record?.current || record.cleanedAt) throw new Error('No completed split to clean up.')
      const api = apiFactory(record.config.network), tx = await api.tx(record.current.txid), tip = await api.tip()
      if (!tx.status?.confirmed || !Number.isSafeInteger(tip) || !Number.isInteger(tx.status.block_height) || tip - tx.status.block_height + 1 < 3) throw new Error('Cleanup requires three confirmations.')
      if ((await funding(record, api)).length) throw new Error('Funds remain. Keep the key and share them first.')
      delete record.privateKey
      record.cleanedAt = Date.now(); record.state = 'cleaned'; record.notice = 'Local temporary key deleted. Address retained as a receipt; never reuse it.'
      return save(record)
    })
  }
  async function setPaused(id, paused) {
    return exclusive(id, async () => {
      const record = await store.get(id)
      if (!record) throw new Error('Request not found.')
      record.paused = Boolean(paused)
      return save(record)
    })
  }
  async function exportRecovery(id) {
    return exclusive(id, async () => {
      const record = await store.get(id)
      if (!record) throw new Error('Request not found.')
      return { format: 'simple-gift-sharer-recovery-v1', exportedAt: new Date().toISOString(), record, demoRecipients: (await store.list()).filter(r => r.kind === 'demo-recipients') }
    })
  }
  async function importRecovery(backup) {
    if (backup?.format !== 'simple-gift-sharer-recovery-v1') throw new Error('Unrecognized recovery file.')
    const r = backup.record
    if (!r || r.kind !== 'gift' || r.version !== 1 || !/^[a-f0-9-]{36}$/.test(r.id) || !/^[a-f0-9]{64}$/.test(r.privateKey || '')) throw new Error('This file has no usable temporary key.')
    if (!NETWORKS[r.config?.network] || !['mempool', 'confirmed'].includes(r.config.fundingPolicy) || !['economy', 'normal', 'priority'].includes(r.config.feePreference) || !Number.isSafeInteger(r.config.expectedSats) || r.config.expectedSats < 1 || !Number.isFinite(r.config.maxFeeRate) || r.config.maxFeeRate < 1 || r.config.maxFeeRate > 1000 || !Number.isFinite(r.config.maxFeePercent) || r.config.maxFeePercent < 1 || r.config.maxFeePercent > 50) throw new Error('Invalid recovery configuration.')
    validateShares(r.config.recipients)
    for (const recipient of r.config.recipients) {
      const validated = await recipientScript(bitcoin, recipient.address, r.config.network)
      if (validated.address !== recipient.address || validated.script !== recipient.script) throw new Error('Recovery destination mismatch.')
    }
    const pub = await bitcoin.wallet.getPublicKey(r.privateKey)
    if (pub !== r.publicKey || await bitcoin.address.generateAddress(pub, 'segwit', NETWORKS[r.config.network].sdk) !== r.address) throw new Error('Recovery key/address mismatch.')
    if (r.current) {
      verifySignedPlan(r.current.raw, r.current)
      if (await transactionId(r.current.raw) !== r.current.txid) throw new Error('Recovery transaction ID mismatch.')
      // A recovery file may contain arbitrary signed bytes: ensure its outputs still
      // match the frozen split and its inputs really belong to this key, on tick.
      const plan = makePlan(r.current.inputs, r.config.recipients, r.current.feeRate, r.config)
      if (JSON.stringify(plan.outputs) !== JSON.stringify(r.current.outputs) || plan.fee !== r.current.fee) throw new Error('Recovery split plan mismatch.')
    }
    // A fresh browser already creates its own demo keys before import. Merge,
    // rather than skip, recovered recipient keys so their received coins remain
    // spendable through the test-forwarding panel on that browser too.
    if (await store.get(r.id)) throw new Error('This request already exists here. Resume its current local copy.')
    const incoming = []
    for (const d of backup.demoRecipients || []) {
      if (d.kind !== 'demo-recipients' || d.id !== 'demo-testnet4' || !Array.isArray(d.keys) || d.keys.length > 500) throw new Error('Invalid recovered test purses.')
      for (const key of d.keys) {
        if (!/^[a-f0-9]{64}$/.test(key.privateKey || '')) throw new Error('Invalid recovered test key.')
        const publicKey = await bitcoin.wallet.getPublicKey(key.privateKey)
        if (publicKey !== key.publicKey || await bitcoin.address.generateAddress(publicKey, 'segwit', 'testnet') !== key.address) throw new Error('Recovered test key/address mismatch.')
        incoming.push({ privateKey: key.privateKey, publicKey, address: key.address })
      }
    }
    if (incoming.length) await exclusive('demo-recipients', async () => {
      const existing = await store.get('demo-testnet4') || { id: 'demo-testnet4', kind: 'demo-recipients', keys: [] }
      const merged = new Map(existing.keys.map(key => [key.address, key]))
      for (const key of incoming) merged.set(key.address, key)
      existing.keys = [...merged.values()]
      await store.put(existing)
    })
    // Never overwrite an existing record with stale exported state.
    return exclusive(r.id, async () => {
      if (await store.get(r.id)) throw new Error('This request already exists here. Resume its current local copy.')
      r.paused = true; r.lastError = ''; r.notice = 'Recovered. Review recipients, then resume watching.'
      await store.put(clone(r))
      return r
    })
  }
  return { create, tick, cleanup, shareLateFunds, exportRecovery, importRecovery, setPaused }
}
