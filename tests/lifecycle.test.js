import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSharer, recipientScript } from '../lib/sharer.js'
import { inspectTransaction, verifySignedPlan, transactionId } from '../lib/transaction.js'
import { equalShares } from '../lib/math.js'

const sdkPath = process.env.SDK_MODULE
const bitcoin = sdkPath ? await import(sdkPath) : null
const realTest = (name, fn) => test(name, { skip: !bitcoin && 'Set SDK_MODULE to a local bitcoin-sdk-js ESM bundle to run signing tests.' }, fn)
function storage() {
  const map = new Map()
  return { map, async get(id) { return structuredClone(map.get(id)) }, async list() { return structuredClone([...map.values()]) }, async put(value) { map.set(value.id, structuredClone(value)) } }
}
function locking() {
  let pending = Promise.resolve()
  return { request(name, fn) { const result = pending.then(fn); pending = result.catch(() => {}); return result } }
}
async function setup(options = {}) {
  const store = storage(), locks = locking(), transactions = new Map(), bodies = []
  let coins = [], height = 100, rate = 1, failBroadcast = false
  const notFound = () => Object.assign(new Error('Not found'), { status: 404 })
  const api = {
    async fees() { return { economyFee: rate, halfHourFee: rate, fastestFee: rate } },
    async utxos() { return coins },
    async tx(id) { if (!transactions.has(id)) throw notFound(); return transactions.get(id) },
    async tip() { return height },
    async outspend() { return { spent: false } },
    async broadcast(raw) { bodies.push(raw); if (failBroadcast) throw new Error('Broadcast response lost'); return transactionId(raw) },
  }
  const sharer = createSharer({ bitcoin, store, locks, apiFactory: () => api })
  const recipients = await Promise.all(equalShares(options.count || 2).map(async (bps, i) => {
    const key = await bitcoin.wallet.generateKeyPair()
    return { bps, label: `Recipient ${i + 1}`, address: await bitcoin.address.generateAddress(key.publicKey, 'segwit', 'testnet') }
  }))
  const record = await sharer.create({ network: 'testnet4', recipients, expectedSats: options.amount || 5000, feePreference: 'economy', maxFeeRate: 20, maxFeePercent: 25, fundingPolicy: options.policy || 'mempool' })
  const ownScript = await bitcoin.script.getScriptByAddress(record.address)
  function fund(value = 5000, confirmed = false, id = 'ab'.repeat(32)) {
    coins = [...coins.filter(u => u.txid !== id), { txid: id, vout: 0, value, status: { confirmed } }]
    transactions.set(id, { txid: id, vout: [{ value, scriptpubkey: ownScript }], status: { confirmed } })
  }
  return { record, sharer, store, api, bodies, transactions, fund, get coins() { return coins }, set coins(v) { coins = v }, set height(v) { height = v }, set rate(v) { rate = v }, set failBroadcast(v) { failBroadcast = v } }
}
realTest('real SDK generates addresses, signs two shares, and matches an independent txid/size parser', async () => {
  const f = await setup(); f.fund()
  const record = await f.sharer.tick(f.record.id)
  assert.equal(record.state, 'confirming'); assert.equal(f.bodies.length, 1)
  const parsed = inspectTransaction(record.current.raw)
  assert.equal(parsed.inputs.length, 1); assert.equal(parsed.outputs.length, 2)
  assert.equal(parsed.outputs.reduce((s, o) => s + o.value, 0) + record.current.fee, 5000)
  assert.equal(await transactionId(record.current.raw), record.current.txid)
  assert.ok(record.current.actualFeeRate >= 1)
  // Verify the actual witness signature against a separately reconstructed sighash.
  const verifier = new bitcoin.Transaction()
  for (const u of record.current.inputs) await verifier.addInput({ txHash: u.txid, index: u.vout, value: u.value })
  for (const o of record.current.outputs) await verifier.addOutput({ address: o.address, value: o.value })
  const own = await bitcoin.script.getScriptByAddress(record.address)
  const hash = await verifier.getInputHashToSign('76a914' + own.slice(4) + '88ac', 0)
  assert.equal(await bitcoin.crypto.verify(parsed.witnesses[0][0], hash, record.publicKey), true)
  const changed = structuredClone(record.current); changed.outputs[0].value++
  assert.throws(() => verifySignedPlan(record.current.raw, changed), /output differs/)
})
realTest('signed bytes commit before broadcast; lost responses and reloads retry identical bytes', async () => {
  const f = await setup(); f.fund(); f.failBroadcast = true
  const first = await f.sharer.tick(f.record.id)
  assert.match(first.lastError, /response lost/)
  assert.equal((await f.store.get(first.id)).current.raw, f.bodies[0])
  f.failBroadcast = false
  const second = await f.sharer.tick(first.id)
  assert.equal(second.current.txid, first.current.txid)
  assert.equal(f.bodies.length, 2); assert.equal(f.bodies[0], f.bodies[1])
})
realTest('storage failure before signed commit prevents any broadcast', async () => {
  const f = await setup(); f.fund(); const original = f.store.put
  f.store.put = async r => { if (r.current) throw new Error('Disk full'); return original(r) }
  await assert.rejects(f.sharer.tick(f.record.id), /Disk full/)
  assert.equal(f.bodies.length, 0)
  assert.equal((await f.store.get(f.record.id)).current, null)
})
realTest('multiple tabs serialize and never sign a second competing transaction', async () => {
  const f = await setup(); f.fund()
  const [a, b] = await Promise.all([f.sharer.tick(f.record.id), f.sharer.tick(f.record.id)])
  assert.equal(a.current.raw, b.current.raw)
  assert.equal(new Set(f.bodies).size, 1)
})
realTest('confirmed-only policy waits; fee ceiling failures retain the key', async () => {
  const f = await setup({ policy: 'confirmed' }); f.fund()
  assert.equal((await f.sharer.tick(f.record.id)).current, null)
  f.fund(5000, true); f.rate = 21
  const held = await f.sharer.tick(f.record.id)
  assert.match(held.lastError, /limit/); assert.ok(held.privateKey); assert.equal(f.bodies.length, 0)
  f.rate = 1
  assert.ok((await f.sharer.tick(f.record.id)).current)
})
realTest('cleanup requires three confirmations AND an empty address; late funds remain recoverable', async () => {
  const f = await setup(); f.fund(); let r = await f.sharer.tick(f.record.id)
  await assert.rejects(f.sharer.cleanup(r.id), /Not found/)
  f.transactions.set(r.current.txid, { txid: r.current.txid, status: { confirmed: true, block_height: 99 } })
  f.coins = []; f.height = 100
  await assert.rejects(f.sharer.cleanup(r.id), /three confirmations/)
  f.height = 101; f.fund(5000, true, 'cd'.repeat(32))
  await assert.rejects(f.sharer.cleanup(r.id), /Funds remain/)
  r = await f.sharer.tick(r.id); assert.equal(r.state, 'complete'); assert.equal(r.observedSats, 5000)
  await f.sharer.shareLateFunds(r.id)
  r = await f.sharer.tick(r.id); assert.equal(r.history.length, 1); assert.ok(r.privateKey)
  f.transactions.set(r.current.txid, { txid: r.current.txid, status: { confirmed: true, block_height: 99 } }); f.coins = []
  r = await f.sharer.cleanup(r.id)
  assert.equal(r.state, 'cleaned'); assert.equal(r.privateKey, undefined)
})
realTest('recovery re-derives the address, validates the signed plan, and imports paused', async () => {
  const f = await setup(); f.fund(); const r = await f.sharer.tick(f.record.id)
  const backup = await f.sharer.exportRecovery(r.id)
  const store = storage(), recovered = createSharer({ bitcoin, store, locks: locking(), apiFactory: () => f.api })
  const imported = await recovered.importRecovery(backup)
  assert.equal(imported.paused, true)
  const before = f.bodies.length; await recovered.tick(imported.id); assert.equal(f.bodies.length, before)
  await recovered.setPaused(imported.id, false); await recovered.tick(imported.id); assert.equal(f.bodies.length, before + 1)
  await assert.rejects(recovered.importRecovery(backup), /already exists/)
  const corrupt = structuredClone(backup); corrupt.record.address = corrupt.record.config.recipients[0].address
  await assert.rejects(recovered.importRecovery(corrupt), /mismatch/)
  const raw = structuredClone(backup); raw.record.current.txid = 'ff'.repeat(32)
  await assert.rejects(recovered.importRecovery(raw), /ID mismatch/)
})
realTest('missing SDK locks and wrong-network/checksum addresses are rejected', async () => {
  const f = await setup()
  const unsupported = createSharer({ bitcoin, store: f.store, locks: null })
  await assert.rejects(unsupported.create({}), /Web Locks/)
  await assert.rejects(recipientScript(bitcoin, f.record.address, 'mainnet'), /selected network/)
  await assert.rejects(recipientScript(bitcoin, f.record.address.slice(0, -1) + (f.record.address.endsWith('q') ? 'p' : 'q'), 'testnet4'), /checksum/)
})
realTest('50 outputs work with enough funding', async () => {
  const f = await setup({ count: 50, amount: 100000 }); f.fund(100000, true)
  const r = await f.sharer.tick(f.record.id)
  assert.equal(r.current.outputs.length, 50)
  assert.equal(r.current.outputs.reduce((s, o) => s + o.value, 0) + r.current.fee, 100000)
})

realTest('multiple funding inputs conserve value and validate every funding script', async () => {
  const f = await setup(); f.fund(2500, true); f.fund(2500, true, 'cd'.repeat(32))
  const r = await f.sharer.tick(f.record.id)
  assert.equal(r.current.inputs.length, 2)
  assert.equal(r.current.outputs.reduce((s, o) => s + o.value, 0) + r.current.fee, 5000)
  assert.equal(inspectTransaction(r.current.raw).inputs.length, 2)
  assert.ok(r.current.actualFeeRate >= 1)
})
realTest('mismatched funding scripts and input conflicts stop automatic broadcast', async () => {
  const f = await setup(); f.fund()
  f.transactions.get('ab'.repeat(32)).vout[0].scriptpubkey = '0014' + 'ff'.repeat(20)
  let r = await f.sharer.tick(f.record.id)
  assert.match(r.lastError, /verification failed/); assert.equal(f.bodies.length, 0); assert.ok(r.privateKey)
  f.fund(); f.failBroadcast = true; r = await f.sharer.tick(f.record.id)
  assert.ok(r.current); f.failBroadcast = false
  f.api.outspend = async () => ({ spent: true, txid: 'ef'.repeat(32) })
  r = await f.sharer.tick(f.record.id)
  assert.match(r.lastError, /different transaction/)
  assert.equal(f.bodies.length, 1); assert.ok(r.privateKey)
})
realTest('Mainnet keys and native witness destinations use the correct network', async () => {
  const keys = await bitcoin.wallet.generateKeyPair()
  const address = await bitcoin.address.generateAddress(keys.publicKey, 'segwit', 'mainnet')
  assert.match(address, /^bc1q/)
  assert.match((await recipientScript(bitcoin, address, 'mainnet')).script, /^0014/)
  await assert.rejects(recipientScript(bitcoin, address, 'testnet4'), /selected network/)
  await assert.rejects(recipientScript(bitcoin, address.slice(0, 5).toUpperCase() + address.slice(5), 'mainnet'), /Mixed-case/)
})

realTest('recovery merges validated recipient keys into an already initialized browser', async () => {
  const f = await setup(), incoming = await bitcoin.wallet.generateKeyPair(), local = await bitcoin.wallet.generateKeyPair()
  incoming.address = await bitcoin.address.generateAddress(incoming.publicKey, 'segwit', 'testnet')
  local.address = await bitcoin.address.generateAddress(local.publicKey, 'segwit', 'testnet')
  await f.store.put({ id: 'demo-testnet4', kind: 'demo-recipients', keys: [incoming] })
  const backup = await f.sharer.exportRecovery(f.record.id), store = storage()
  await store.put({ id: 'demo-testnet4', kind: 'demo-recipients', keys: [local] })
  const recovered = createSharer({ bitcoin, store, locks: locking(), apiFactory: () => f.api })
  await recovered.importRecovery(backup)
  assert.deepEqual((await store.get('demo-testnet4')).keys.map(k => k.address), [local.address, incoming.address])
  const corrupt = structuredClone(backup); corrupt.record.id = crypto.randomUUID(); corrupt.demoRecipients[0].keys[0].address = local.address
  await assert.rejects(recovered.importRecovery(corrupt), /key\/address mismatch/)
})
