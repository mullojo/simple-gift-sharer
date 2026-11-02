import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocate, equalShares, makePlan, validateShares } from '../lib/math.js'
const shares = n => equalShares(n).map((bps, i) => ({ address: `address-${i}`, bps, script: '0014' + 'ab'.repeat(20) }))
test('2–50 equal shares preserve exactly 100%, including 3-way rounding', () => {
  for (let n = 2; n <= 50; n++) { const bps = equalShares(n); assert.equal(bps.reduce((s, x) => s + x), 10000); assert.ok(Math.max(...bps) - Math.min(...bps) <= 1) }
  assert.deepEqual(equalShares(3), [3334, 3333, 3333])
})
test('largest-remainder allocation conserves every sat and gives deterministic ties', () => {
  for (let n = 2; n <= 50; n++) for (const sats of [1, 5000, 1234567, 2100000000000000]) {
    const outputs = allocate(sats, shares(n))
    assert.equal(outputs.reduce((s, o) => s + o.value, 0), sats)
    outputs.forEach(o => assert.ok(Number.isSafeInteger(o.value) && o.value >= 0))
  }
  assert.deepEqual(allocate(4857, shares(2)).map(o => o.value), [2429, 2428])
})
test('invalid weights, duplicate recipients, dust and fee budgets block sharing', () => {
  assert.throws(() => validateShares([{ address: 'a', bps: 5000 }, { address: 'a', bps: 5000 }]), /different/)
  assert.throws(() => validateShares([{ address: 'a', bps: 5000 }, { address: 'b', bps: 4999 }]), /100%/)
  const limits = { maxFeeRate: 20, maxFeePercent: 25 }, inputs = [{ value: 5000 }]
  const plan = makePlan(inputs, shares(2), 1, limits)
  assert.equal(plan.fee, 143)
  assert.equal(plan.outputs.reduce((s, o) => s + o.value, 0) + plan.fee, 5000)
  assert.throws(() => makePlan(inputs, shares(2), 21, limits), /limit/)
  assert.throws(() => makePlan(inputs, shares(2), 10, limits), /budget/)
  assert.throws(() => makePlan(inputs, shares(50), 1, { ...limits, maxFeePercent: 50 }), /546/)
})
