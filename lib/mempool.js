export const NETWORKS = {
  testnet4: { label: 'Testnet4', sdk: 'testnet', prefix: 'tb', explorer: 'https://mempool.space/testnet4' },
  mainnet: { label: 'Mainnet', sdk: 'mainnet', prefix: 'bc', explorer: 'https://mempool.space' },
}
export class ApiError extends Error { constructor(message, status) { super(message); this.status = status } }
export function mempool(network, fetcher = globalThis.fetch) {
  if (!NETWORKS[network]) throw new Error('Unknown network.')
  const base = NETWORKS[network].explorer + '/api'
  async function request(path, { text = false, ...options } = {}) {
    const response = await fetcher(base + path, { cache: 'no-store', signal: AbortSignal.timeout(15000), ...options })
    if (!response.ok) { const body = (await response.text()).slice(0, 300); throw new ApiError(`${response.status === 429 ? 'Mempool is busy; checking will resume.' : 'Mempool request failed'} (${response.status}): ${body}`, response.status) }
    return text ? response.text() : response.json()
  }
  return {
    fees: () => request('/v1/fees/recommended'),
    prices: () => network === 'mainnet' ? request('/v1/prices') : mempool('mainnet', fetcher).prices(),
    utxos: address => request(`/address/${encodeURIComponent(address)}/utxo`),
    tx: txid => request(`/tx/${txid}`),
    tip: async () => Number(await request('/blocks/tip/height', { text: true })),
    outspend: (txid, index) => request(`/tx/${txid}/outspend/${index}`),
    broadcast: raw => request('/tx', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: raw, text: true }),
  }
}
export function chooseFee(fees, preference) {
  const value = { economy: fees.economyFee, normal: fees.halfHourFee, priority: fees.fastestFee }[preference]
  if (!Number.isFinite(value) || value <= 0) throw new Error('A valid live fee estimate is unavailable.')
  return Math.ceil(value * 100) / 100
}
