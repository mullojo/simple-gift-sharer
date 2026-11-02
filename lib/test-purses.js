// Manual Testnet4-only spending from the demo recipient keys. No UI dependency.
import { recipientScript } from './sharer.js'
import { mempool, chooseFee } from './mempool.js'
import { DUST, estimateVbytes } from './math.js'
import { verifySignedPlan, transactionId } from './transaction.js'
const TXID = /^[a-f0-9]{64}$/
const LAST = 'testnet4-forward'
export function createTestPurses({ bitcoin, store, api = mempool('testnet4'), locks = globalThis.navigator?.locks }) {
  async function exclusive(action) {
    if (!locks?.request) throw new Error('Web Locks are required on localhost or HTTPS.')
    return locks.request('simple-gift-sharer:demo-recipients', action)
  }
  async function keys() {
    const record = await store.get('demo-testnet4')
    if (!record?.keys?.length) throw new Error('No generated Testnet4 recipient keys are saved in this browser.')
    return record.keys
  }
  async function coins(address) {
    const values = await api.utxos(address)
    if (!Array.isArray(values) || values.length > 100) throw new Error('Unexpected funding response.')
    const rows = values.map(u => {
      if (!TXID.test(u.txid) || !Number.isInteger(u.vout) || u.vout < 0 || !Number.isSafeInteger(u.value) || u.value <= 0) throw new Error('Invalid funding output.')
      return { txid: u.txid, vout: u.vout, value: u.value, confirmed: Boolean(u.status?.confirmed), address }
    })
    if (new Set(rows.map(u => `${u.txid}:${u.vout}`)).size !== rows.length) throw new Error('Duplicate funding outputs.')
    return rows
  }
  async function balances() {
    const result = []
    for (const [i, key] of (await keys()).entries()) {
      const utxos = await coins(key.address)
      result.push({ index: i, address: key.address, confirmed: utxos.filter(u => u.confirmed).reduce((s, u) => s + u.value, 0), pending: utxos.filter(u => !u.confirmed).reduce((s, u) => s + u.value, 0) })
    }
    return result
  }
  async function status() {
    const saved = await store.get(LAST)
    if (!saved) return null
    try {
      const tx = await api.tx(saved.txid)
      return { ...saved, seen: tx.txid === saved.txid, confirmed: Boolean(tx.status?.confirmed) }
    } catch (e) { if (e.status === 404) return { ...saved, seen: false, confirmed: false }; throw e }
  }
  async function available() {
    const previous = await status()
    if (previous && !previous.confirmed) throw new Error('A previous forward is still pending. Use Check / retry saved forward; wait for confirmation before creating another.')
  }
  async function prepare({ destination, sourceAddresses, feePreference = 'economy', maxFeeRate = 20, maxFeePercent = 25 }) {
    return exclusive(async () => {
      await available()
      if (!Number.isFinite(maxFeeRate) || maxFeeRate < 1 || maxFeeRate > 1000 || !Number.isFinite(maxFeePercent) || maxFeePercent < 1 || maxFeePercent > 50) throw new Error('Invalid fee limits.')
      const dest = await recipientScript(bitcoin, destination, 'testnet4')
      const allKeys = await keys()
      if (!Array.isArray(sourceAddresses) || !sourceAddresses.length || new Set(sourceAddresses).size !== sourceAddresses.length || sourceAddresses.some(a => !allKeys.some(k => k.address === a))) throw new Error('Select saved, generated Testnet4 recipient purses.')
      if (sourceAddresses.includes(dest.address)) throw new Error('Choose a destination outside the selected source purses.')
      const inputs = (await Promise.all(sourceAddresses.map(coins))).flat().filter(u => u.confirmed).sort((a, b) => a.txid.localeCompare(b.txid) || a.vout - b.vout)
      if (!inputs.length) throw new Error('No confirmed coins yet. Wait for the split transaction to confirm, then refresh.')
      if (new Set(inputs.map(u => `${u.txid}:${u.vout}`)).size !== inputs.length) throw new Error('Duplicate funding inputs.')
      const total = inputs.reduce((s, u) => s + u.value, 0)
      if (!Number.isSafeInteger(total)) throw new Error('Invalid total amount.')
      const feeRate = chooseFee(await api.fees(), feePreference)
      if (feeRate > maxFeeRate) throw new Error('The live fee recommendation exceeds your rate limit.')
      const estimatedVbytes = estimateVbytes(inputs.length, [dest.script.length / 2]), fee = Math.ceil(estimatedVbytes * feeRate)
      if (fee * 100 > total * maxFeePercent) throw new Error('The fee exceeds your percentage budget. Wait for lower fees or select more funds.')
      if (total - fee < DUST) throw new Error(`The destination needs at least ${DUST} sats after fees.`)
      const plan = { id: crypto.randomUUID(), network: 'testnet4', createdAt: Date.now(), expiresAt: Date.now() + 120000, inputs, total, outputs: [{ ...dest, value: total - fee }], estimatedVbytes, fee, feeRate, feePreference, maxFeeRate, maxFeePercent }
      await store.put({ id: `test-forward-review:${plan.id}`, kind: 'test-forward-review', plan })
      return plan
    })
  }
  async function broadcastSaved(saved) {
    const seen = await status()
    if (seen?.txid === saved.txid && seen.seen) return seen
    for (const u of saved.plan.inputs) {
      const spent = await api.outspend(u.txid, u.vout)
      if (spent.spent && spent.txid !== saved.txid) throw new Error('A source coin was spent elsewhere. Saved forward retained; inspect it in the explorer.')
    }
    const txid = (await api.broadcast(saved.raw)).trim()
    if (txid !== saved.txid) throw new Error('Unexpected broadcast response. Check / retry the saved forward.')
    return { ...saved, seen: true, confirmed: false }
  }
  async function send(reviewId) {
    return exclusive(async () => {
      const previous = await store.get(LAST)
      if (previous?.reviewId === reviewId) return broadcastSaved(previous)
      await available()
      const review = await store.get(`test-forward-review:${reviewId}`), plan = review?.plan
      if (!plan || Date.now() > plan.expiresAt) throw new Error('Review expired. Preview the forward again.')
      const keyring = await keys(), fresh = new Map()
      for (const address of new Set(plan.inputs.map(u => u.address))) fresh.set(address, await coins(address))
      const parents = new Map()
      for (const u of plan.inputs) {
        if (!fresh.get(u.address).some(c => c.txid === u.txid && c.vout === u.vout && c.value === u.value && c.confirmed)) throw new Error('Source funds changed. Preview again.')
        const key = keyring.find(k => k.address === u.address)
        if (!key || await bitcoin.wallet.getPublicKey(key.privateKey) !== key.publicKey || await bitcoin.address.generateAddress(key.publicKey, 'segwit', 'testnet') !== u.address) throw new Error('Saved recipient key does not match its Testnet4 address.')
        if (!parents.has(u.txid)) parents.set(u.txid, await api.tx(u.txid))
        const parent = parents.get(u.txid), out = parent.vout?.[u.vout]
        if (parent.txid !== u.txid || !parent.status?.confirmed || out?.value !== u.value || out.scriptpubkey !== await bitcoin.script.getScriptByAddress(u.address)) throw new Error('Source transaction verification failed.')
      }
      const liveRate = chooseFee(await api.fees(), plan.feePreference)
      if (liveRate > plan.maxFeeRate || Math.ceil(plan.estimatedVbytes * liveRate) > plan.fee) throw new Error('Fees increased. Preview again before sending.')
      const tx = new bitcoin.Transaction()
      for (const u of plan.inputs) await tx.addInput({ txHash: u.txid, index: u.vout, value: u.value })
      for (const o of plan.outputs) await tx.addOutput({ address: o.address, value: o.value })
      for (const [i, u] of plan.inputs.entries()) await tx.signInput(keyring.find(k => k.address === u.address).privateKey, i)
      const raw = await tx.getSignedHex(), txid = await tx.getId(), actual = verifySignedPlan(raw, plan)
      if (await transactionId(raw) !== txid) throw new Error('Signed transaction ID mismatch.')
      const saved = { id: LAST, kind: 'test-forward', network: 'testnet4', reviewId, txid, raw, plan, ...actual, createdAt: Date.now(), history: previous ? [...(previous.history || []), { txid: previous.txid, createdAt: previous.createdAt }] : [] }
      await store.put(saved) // Never broadcast until signed bytes commit to disk.
      return broadcastSaved(saved)
    })
  }
  async function retry() {
    return exclusive(async () => {
      const saved = await store.get(LAST)
      if (!saved) throw new Error('No saved forward to retry.')
      return broadcastSaved(saved)
    })
  }
  return { balances, prepare, send, status, retry }
}
