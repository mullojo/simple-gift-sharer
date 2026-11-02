// No browser dependencies: the money rules can be tested and reused independently.
export const DUST = 546 // Deliberately conservative for the supported witness outputs.
export function equalShares(count) {
  if (!Number.isInteger(count) || count < 2 || count > 50) throw new Error('Choose 2–50 shares.')
  return Array.from({ length: count }, (_, i) => Math.floor(10000 / count) + (i < 10000 % count ? 1 : 0))
}
export function validateShares(recipients) {
  if (!Array.isArray(recipients) || recipients.length < 2 || recipients.length > 50) throw new Error('Use 2–50 recipients.')
  if (recipients.some(r => !Number.isInteger(r.bps) || r.bps <= 0) || recipients.reduce((s, r) => s + r.bps, 0) !== 10000) throw new Error('Positive percentages must add up to exactly 100%.')
  if (new Set(recipients.map(r => r.address)).size !== recipients.length) throw new Error('Use a different address for every recipient.')
}
export function allocate(sats, recipients) {
  validateShares(recipients)
  if (!Number.isSafeInteger(sats) || sats < 0) throw new Error('Invalid sat amount.')
  const rows = recipients.map((r, i) => {
    const product = BigInt(sats) * BigInt(r.bps)
    return { ...r, i, value: Number(product / 10000n), remainder: Number(product % 10000n) }
  })
  let spare = sats - rows.reduce((s, r) => s + r.value, 0)
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.i - b.i)) if (spare-- > 0) row.value++
  return rows.map(({ i, remainder, ...r }) => r)
}
export function estimateVbytes(inputCount, scriptBytes) {
  // 70 vB per compressed P2WPKH input is a conservative upper bound.
  if (!Number.isInteger(inputCount) || inputCount < 1 || inputCount > 100) throw new Error('Use 1–100 funding inputs.')
  return Math.ceil(11 + 70 * inputCount + scriptBytes.reduce((s, n) => s + 9 + n, 0))
}
export function makePlan(utxos, recipients, feeRate, { maxFeeRate, maxFeePercent = 25 }) {
  validateShares(recipients)
  if (!Number.isFinite(feeRate) || feeRate <= 0 || feeRate > maxFeeRate) throw new Error(`Live fee is ${feeRate} sat/vB; your limit is ${maxFeeRate}. Waiting for a lower fee.`)
  const total = utxos.reduce((s, u) => s + u.value, 0)
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Invalid funding amount.')
  const vbytes = estimateVbytes(utxos.length, recipients.map(r => r.script.length / 2))
  const fee = Math.ceil(vbytes * feeRate)
  if (fee * 100 > total * maxFeePercent) throw new Error(`The ${fee}-sat fee exceeds your ${maxFeePercent}% fee budget. Add funding or wait for lower fees.`)
  const outputs = allocate(total - fee, recipients)
  if (outputs.some(r => r.value < DUST)) throw new Error(`Each share must be at least ${DUST} sats after fees. Add funding or use fewer shares.`)
  return { inputs: utxos, outputs, total, fee, feeRate, estimatedVbytes: vbytes }
}
export const btc = sats => (sats / 1e8).toFixed(8)
