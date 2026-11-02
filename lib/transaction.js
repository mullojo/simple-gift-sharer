// Parse the actual signed bytes, rather than relying only on a size estimate.
export function inspectTransaction(hex) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('Invalid transaction hex.')
  const bytes = Uint8Array.from(hex.match(/../g), h => parseInt(h, 16))
  const view = new DataView(bytes.buffer)
  let p = 0
  const take = n => { if (p + n > bytes.length) throw new Error('Truncated transaction.'); const v = bytes.slice(p, p + n); p += n; return v }
  const toHex = b => Array.from(b, v => v.toString(16).padStart(2, '0')).join('')
  const u32 = () => { take(4); return view.getUint32(p - 4, true) }
  const variable = () => { const n = take(1)[0]; if (n < 253) return n; if (n === 253) { take(2); return view.getUint16(p - 2, true) } if (n === 254) return u32(); throw new Error('Oversized transaction.') }
  take(4)
  const segwit = bytes[p] === 0 && bytes[p + 1] === 1
  if (segwit) take(2)
  const inputCount = variable()
  if (!inputCount || inputCount > 100) throw new Error('Unexpected input count.')
  const inputs = Array.from({ length: inputCount }, () => {
    const txid = toHex(take(32).reverse()), vout = u32()
    const script = toHex(take(variable())), sequence = u32()
    return { txid, vout, script, sequence }
  })
  const outputCount = variable()
  if (!outputCount || outputCount > 50) throw new Error('Unexpected output count.')
  const outputs = Array.from({ length: outputCount }, () => {
    take(8); const value = Number(view.getBigUint64(p - 8, true))
    if (!Number.isSafeInteger(value)) throw new Error('Unsafe output value.')
    return { value, script: toHex(take(variable())) }
  })
  const witnessStart = p
  const witnesses = []
  if (segwit) for (let i = 0; i < inputCount; i++) { const count = variable(); const stack = []; for (let j = 0; j < count; j++) stack.push(toHex(take(variable()))); witnesses.push(stack) }
  const witnessBytes = p - witnessStart
  take(4)
  if (p !== bytes.length) throw new Error('Unexpected trailing transaction bytes.')
  const strippedBytes = bytes.length - witnessBytes - (segwit ? 2 : 0)
  const strippedHex = segwit ? toHex(bytes.slice(0, 4)) + toHex(bytes.slice(6, witnessStart)) + toHex(bytes.slice(-4)) : hex
  return { inputs, outputs, witnesses, strippedHex, bytes: bytes.length, vbytes: Math.ceil((strippedBytes * 4 + bytes.length - strippedBytes) / 4) }
}
export function verifySignedPlan(hex, plan) {
  const tx = inspectTransaction(hex)
  if (tx.inputs.length !== plan.inputs.length || tx.outputs.length !== plan.outputs.length) throw new Error('Signed transaction shape differs from the plan.')
  tx.inputs.forEach((input, i) => {
    if (input.txid !== plan.inputs[i].txid || input.vout !== plan.inputs[i].vout || input.script !== '') throw new Error('Signed input differs from the plan.')
  })
  tx.outputs.forEach((output, i) => {
    if (output.value !== plan.outputs[i].value || output.script !== plan.outputs[i].script) throw new Error('Signed output differs from the plan.')
  })
  if (plan.fee < Math.ceil(tx.vbytes * plan.feeRate)) throw new Error('Signed transaction fee is below the selected rate.')
  return { vbytes: tx.vbytes, actualFeeRate: plan.fee / tx.vbytes }
}

export async function transactionId(hex) {
  const { strippedHex } = inspectTransaction(hex)
  const bytes = Uint8Array.from(strippedHex.match(/../g), h => parseInt(h, 16))
  const first = await crypto.subtle.digest('SHA-256', bytes)
  const second = new Uint8Array(await crypto.subtle.digest('SHA-256', first))
  return Array.from(second.reverse(), b => b.toString(16).padStart(2, '0')).join('')
}
