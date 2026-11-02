import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestPurses } from '../lib/test-purses.js'
import { inspectTransaction, transactionId } from '../lib/transaction.js'
const bitcoin = process.env.SDK_MODULE ? await import(process.env.SDK_MODULE) : null
const realTest = (name, fn) => test(name, { skip: !bitcoin && 'Set SDK_MODULE for real-signing tests.' }, fn)
async function fixture() {
  const records = new Map(), map = new Map(), transactions = new Map(), sent = []
  const store = { async get(id) { return structuredClone(records.get(id)) }, async put(r) { records.set(r.id, structuredClone(r)) } }
  let queue = Promise.resolve(), rate = 1, loseResponse = false
  const locks = { request(name, action) { const result = queue.then(action); queue = result.catch(() => {}); return result } }
  const notFound = () => Object.assign(new Error('Not found'), { status: 404 })
  const api = {
    async utxos(address) { return structuredClone(map.get(address) || []) },
    async fees() { return { economyFee: rate, halfHourFee: rate, fastestFee: rate } },
    async tx(id) { if (!transactions.has(id)) throw notFound(); return structuredClone(transactions.get(id)) },
    async outspend() { return { spent: false } },
    async broadcast(raw) { sent.push(raw); if (loseResponse) throw new Error('Lost response'); return transactionId(raw) },
  }
  const keys = []
  for (let i = 0; i < 3; i++) {
    const k = await bitcoin.wallet.generateKeyPair()
    keys.push({ ...k, address: await bitcoin.address.generateAddress(k.publicKey, 'segwit', 'testnet') })
  }
  await store.put({ id: 'demo-testnet4', kind: 'demo-recipients', keys })
  for (let i = 0; i < 2; i++) {
    const txid = (i ? 'cd' : 'ab').repeat(32), value = i ? 2428 : 2429
    map.set(keys[i].address, [{ txid, vout: 0, value, status: { confirmed: true } }])
    transactions.set(txid, { txid, status: { confirmed: true }, vout: [{ value, scriptpubkey: await bitcoin.script.getScriptByAddress(keys[i].address) }] })
  }
  const purses = createTestPurses({ bitcoin, store, api, locks })
  const config = { destination: keys[2].address, sourceAddresses: keys.slice(0, 2).map(k => k.address) }
  return { purses, config, records, map, transactions, keys, sent, store, set rate(v) { rate = v }, set loseResponse(v) { loseResponse = v } }
}
realTest('two generated recipient purses forward to one output with both correct signatures', async () => {
  const f = await fixture(), balances = await f.purses.balances()
  assert.deepEqual(balances.map(r => r.confirmed), [2429, 2428, 0])
  assert.ok(balances.every(r => !('privateKey' in r)))
  const plan = await f.purses.prepare(f.config)
  assert.equal(f.sent.length, 0, 'preview must not broadcast')
  const result = await f.purses.send(plan.id), parsed = inspectTransaction(result.raw)
  assert.equal(parsed.inputs.length, 2); assert.equal(parsed.outputs.length, 1)
  assert.equal(parsed.outputs[0].value + plan.fee, 4857)
  assert.equal(result.txid, await transactionId(result.raw))
  const verifier = new bitcoin.Transaction()
  for (const u of plan.inputs) await verifier.addInput({ txHash: u.txid, index: u.vout, value: u.value })
  await verifier.addOutput({ address: plan.outputs[0].address, value: plan.outputs[0].value })
  for (const [i, input] of plan.inputs.entries()) {
    const key = f.keys.find(k => k.address === input.address), own = await bitcoin.script.getScriptByAddress(input.address)
    const hash = await verifier.getInputHashToSign('76a914' + own.slice(4) + '88ac', i)
    assert.equal(await bitcoin.crypto.verify(parsed.witnesses[i][0], hash, key.publicKey), true)
  }
  assert.equal(f.records.get('demo-testnet4').keys.length, 3, 'recipient keys are retained')
})
realTest('individual recipient can forward independently; unconfirmed funds wait', async () => {
  const f = await fixture()
  f.config.sourceAddresses = [f.keys[0].address]
  const plan = await f.purses.prepare(f.config)
  assert.equal(plan.inputs.length, 1); assert.equal(plan.total, 2429)
  f.map.get(f.keys[0].address)[0].status.confirmed = false
  await assert.rejects(f.purses.send(plan.id), /funds changed/)
  await assert.rejects(f.purses.prepare(f.config), /No confirmed coins/)
  assert.equal(f.sent.length, 0)
})
realTest('unknown sources, Mainnet destinations, changed fees, and excessive fees are blocked', async () => {
  const f = await fixture()
  await assert.rejects(f.purses.prepare({ ...f.config, sourceAddresses: ['tb1qforeign'] }), /Select saved/)
  const mainnet = await bitcoin.address.generateAddress(f.keys[2].publicKey, 'segwit', 'mainnet')
  await assert.rejects(f.purses.prepare({ ...f.config, destination: mainnet }), /selected network/)
  const plan = await f.purses.prepare(f.config); f.rate = 2
  await assert.rejects(f.purses.send(plan.id), /Fees increased/)
  f.rate = 20
  await assert.rejects(f.purses.prepare(f.config), /percentage budget/)
  assert.equal(f.sent.length, 0)
})
realTest('uncertain forwards persist and retry identical bytes; new forwards wait for confirmation', async () => {
  const f = await fixture(), plan = await f.purses.prepare(f.config)
  f.loseResponse = true
  await assert.rejects(f.purses.send(plan.id), /Lost response/)
  const saved = f.records.get('testnet4-forward')
  assert.equal(saved.raw, f.sent[0])
  await assert.rejects(f.purses.prepare(f.config), /previous forward/)
  f.loseResponse = false
  await f.purses.retry()
  assert.equal(f.sent.length, 2); assert.equal(f.sent[0], f.sent[1])
  f.transactions.set(saved.txid, { txid: saved.txid, status: { confirmed: true } })
  assert.equal((await f.purses.retry()).confirmed, true)
  assert.equal(f.sent.length, 2, 'a seen forward is not broadcast again')
})
realTest('failed signed-record commit cannot broadcast; concurrent sends reuse the saved transaction', async () => {
  const f = await fixture(), plan = await f.purses.prepare(f.config), put = f.store.put
  f.store.put = async record => { if (record.kind === 'test-forward') throw new Error('Disk full'); return put(record) }
  await assert.rejects(f.purses.send(plan.id), /Disk full/); assert.equal(f.sent.length, 0)
  f.store.put = put
  const [a, b] = await Promise.all([f.purses.send(plan.id), f.purses.send(plan.id)])
  assert.equal(a.txid, b.txid); assert.equal(new Set(f.sent).size, 1)
})
