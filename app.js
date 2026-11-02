import { bitcoin, createApp, ref, computed, onMounted, watch, nextTick } from './deps.js'
import { equalShares, makePlan, btc } from './lib/math.js'
import { mempool, NETWORKS, chooseFee } from './lib/mempool.js'
import { createStore } from './lib/storage.js'
import { createSharer, recipientScript } from './lib/sharer.js'
import { createTestPurses } from './lib/test-purses.js'

const store = createStore(), sharer = createSharer({ bitcoin, store }), testPurses = createTestPurses({ bitcoin, store })
const download = (data, name) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
createApp({
  setup() {
    const network = ref('testnet4'), count = ref(2), recipients = ref([]), amount = ref(5000), unit = ref('sats')
    const preference = ref('economy'), maxFeeRate = ref(20), maxFeePercent = ref(25), policy = ref('mempool')
    const fees = ref(null), price = ref(null), estimate = ref(null), estimateError = ref(''), error = ref(''), notice = ref('')
    const sessions = ref([]), active = ref(null), busy = ref(false), checking = ref(false), ready = ref(false), mainnetConsent = ref(false), watching = ref(false)
    const qr = ref(null), recoveryFile = ref(null)
    const testRows = ref([]), testSelected = ref([]), forwardDestination = ref(''), forwardPreference = ref('economy'), forwardMaxRate = ref(20), forwardMaxPercent = ref(25), forwardPlan = ref(null), forwardSaved = ref(null), forwardBusy = ref(false), forwardError = ref('')
    watch([testSelected, forwardDestination, forwardPreference, forwardMaxRate, forwardMaxPercent], () => { forwardPlan.value = null }, { deep: true })
    async function refreshTestPurses() {
      forwardBusy.value = true; forwardError.value = ''
      try {
        const rows = await testPurses.balances()
        if (!testRows.value.length) testSelected.value = rows.slice(0, 2).map(r => r.address)
        testRows.value = rows
        forwardSaved.value = await testPurses.status()
        forwardPlan.value = null
      } catch (e) { forwardError.value = e.message; forwardSaved.value = await store.get('testnet4-forward').catch(() => null) }
      finally { forwardBusy.value = false }
    }
    function testToolsOpen(event) { if (event.target.open) refreshTestPurses() }
    async function previewForward() {
      forwardBusy.value = true; forwardError.value = ''; forwardPlan.value = null
      try { forwardPlan.value = await testPurses.prepare({ destination: forwardDestination.value, sourceAddresses: [...testSelected.value], feePreference: forwardPreference.value, maxFeeRate: Number(forwardMaxRate.value), maxFeePercent: Number(forwardMaxPercent.value) }) }
      catch (e) { forwardError.value = e.message }
      finally { forwardBusy.value = false }
    }
    async function sendForward(retry = false) {
      if (forwardBusy.value) return
      forwardBusy.value = true; forwardError.value = ''
      try {
        forwardSaved.value = retry ? await testPurses.retry() : await testPurses.send(forwardPlan.value.id)
        forwardPlan.value = null
        notice.value = 'Testnet4 forward seen by mempool.space. Follow the transaction link below.'
        testRows.value = await testPurses.balances()
      } catch (e) { forwardError.value = e.message; forwardSaved.value = await store.get('testnet4-forward').catch(() => null); forwardPlan.value = null }
      finally { forwardBusy.value = false }
    }
    const target = computed(() => unit.value === 'sats' ? Number(amount.value) : price.value ? Math.ceil(Number(amount.value) * 1e8 / price.value.USD) : 0)
    const percentages = computed(() => recipients.value.reduce((s, r) => s + Math.round(Number(r.percent) * 100), 0) / 100)
    const explorer = computed(() => NETWORKS[active.value?.config.network || network.value].explorer)
    const uri = computed(() => active.value ? `bitcoin:${active.value.address}?amount=${btc(active.value.config.expectedSats)}&label=Simple%20gift%20sharer` : '')
    const liveNetwork = computed(() => active.value?.config.network || network.value)
    let estimateTimer, pollTimer, estimateTicket = 0, qrData = ''
    const sat = n => Number(n || 0).toLocaleString()
    const short = s => s ? `${s.slice(0, 12)}…${s.slice(-8)}` : ''
    const step = computed(() => !active.value ? 0 : active.value.cleanedAt || active.value.state === 'complete' ? 3 : active.value.current ? 2 : active.value.observedSats ? 1 : 0)
    async function loadSessions() { sessions.value = (await store.list()).filter(r => r.kind === 'gift').sort((a, b) => b.createdAt - a.createdAt) }
    async function testRecipients(n) {
      if (!navigator.locks?.request) throw new Error('Use localhost or HTTPS in a browser with Web Locks support.')
      return navigator.locks.request('simple-gift-sharer:demo-recipients', async () => {
      let saved = await store.get('demo-testnet4') || { id: 'demo-testnet4', kind: 'demo-recipients', keys: [] }
      while (saved.keys.length < n) {
        const keys = await bitcoin.wallet.generateKeyPair()
        saved.keys.push({ ...keys, address: await bitcoin.address.generateAddress(keys.publicKey, 'segwit', 'testnet') })
      }
      await store.put(saved)
      return saved.keys.slice(0, n)
      })
    }
    async function setCount() {
      if (active.value) return
      busy.value = true
      try {
        const shares = equalShares(Number(count.value)), keys = network.value === 'testnet4' ? await testRecipients(shares.length) : []
        recipients.value = shares.map((bps, i) => ({ label: i === 0 ? 'Project' : i === 1 ? 'Referrer' : `Share ${i + 1}`, address: keys[i]?.address || '', percent: bps / 100 }))
      } catch (e) { error.value = e.message }
      finally { busy.value = false; scheduleEstimate() }
    }
    async function refreshFees() {
      try {
        const api = mempool(network.value)
        const [f, p] = await Promise.all([api.fees(), api.prices().catch(() => null)])
        fees.value = f
        price.value = p && Number.isFinite(p.USD) && p.USD > 0 && Number.isFinite(p.time) && Math.abs(Date.now() / 1000 - p.time) < 3600 ? p : null
        await updateEstimate()
      } catch (e) { error.value = e.message; fees.value = null }
    }
    function config() {
      if (unit.value === 'usd' && (!price.value || Math.abs(Date.now() / 1000 - price.value.time) > 3600)) throw new Error('Refresh the USD quote before creating an address.')
      if (recipients.value.some(r => !Number.isFinite(Number(r.percent)) || Math.abs(Number(r.percent) * 100 - Math.round(Number(r.percent) * 100)) > 1e-7)) throw new Error('Use percentages with up to two decimal places.')
      return { network: network.value, expectedSats: target.value, feePreference: preference.value, maxFeeRate: Number(maxFeeRate.value), maxFeePercent: Number(maxFeePercent.value), fundingPolicy: policy.value, recipients: recipients.value.map(r => ({ label: r.label, address: r.address.trim(), bps: Math.round(Number(r.percent) * 100) })) }
    }
    async function updateEstimate() {
      const ticket = ++estimateTicket
      estimate.value = null; estimateError.value = ''
      try {
        const c = config()
        if (!fees.value) throw new Error('Refresh the live fee estimate to continue.')
        c.recipients = await Promise.all(c.recipients.map(async r => ({ ...r, ...await recipientScript(bitcoin, r.address, c.network) })))
        const plan = makePlan([{ value: c.expectedSats }], c.recipients, chooseFee(fees.value, c.feePreference), c)
        if (ticket === estimateTicket) estimate.value = plan
      } catch (e) { if (ticket === estimateTicket) estimateError.value = e.message }
    }
    function scheduleEstimate() { clearTimeout(estimateTimer); estimateTicket++; estimate.value = null; estimateError.value = ''; estimateTimer = setTimeout(updateEstimate, 250) }
    watch([recipients, amount, unit, preference, maxFeeRate, maxFeePercent], scheduleEstimate, { deep: true })
    watch(network, async () => { mainnetConsent.value = false; fees.value = null; price.value = null; await setCount(); await refreshFees() })
    async function renderQr() {
      await nextTick()
      if (!qr.value || !uri.value) return
      if (!globalThis.QRCodeStyling) { error.value = 'QR library unavailable. Copy the address and exact amount instead.'; return }
      if (qrData === uri.value && qr.value.firstChild) return
      qr.value.replaceChildren()
      new globalThis.QRCodeStyling({ width: 232, height: 232, type: 'svg', data: uri.value, margin: 10, qrOptions: { errorCorrectionLevel: 'M' }, dotsOptions: { color: '#a94618', type: 'rounded' }, cornersSquareOptions: { type: 'extra-rounded', color: '#492415' }, backgroundOptions: { color: '#ffffff' } }).append(qr.value)
      qrData = uri.value
    }
    async function create() {
      if (busy.value || active.value) return
      busy.value = true; error.value = ''; notice.value = ''
      try {
        if (network.value === 'mainnet' && !mainnetConsent.value) throw new Error('Confirm Mainnet automatic sharing first.')
        active.value = await sharer.create(config())
        await loadSessions(); await renderQr()
        watching.value = true; await check()
      } catch (e) { error.value = e.message }
      finally { busy.value = false }
    }
    async function check() {
      if (!active.value || checking.value || !watching.value || active.value.cleanedAt) return
      checking.value = true
      const id = active.value.id
      try { const result = await sharer.tick(id); if (active.value?.id === id) active.value = result; await loadSessions() }
      catch (e) { error.value = e.message }
      finally { checking.value = false }
    }
    async function selectSession(event) {
      if (checking.value || busy.value) return
      watching.value = false; error.value = ''; notice.value = ''; qrData = ''
      active.value = await store.get(event.target.value)
      await renderQr()
      // Previously authorized local sessions resume automatically; imported files require Resume.
      watching.value = !active.value.paused; await check()
    }
    async function newRequest() {
      if (checking.value || busy.value) return
      watching.value = false; active.value = null; error.value = ''; notice.value = ''; qrData = ''
      await setCount(); await refreshFees()
    }
    async function copy(value) {
      try { await navigator.clipboard.writeText(value); notice.value = 'Copied.' } catch { error.value = 'Clipboard unavailable. Select and copy the visible address.' }
    }
    async function backup() {
      try {
        if (active.value) download(await sharer.exportRecovery(active.value.id), `gift-sharer-${active.value.config.network}-${active.value.id.slice(0, 8)}.json`)
        else download({ format: 'simple-gift-sharer-test-recipients-v1', ...(await store.get('demo-testnet4')) }, 'testnet4-recipient-keys.json')
        notice.value = 'Recovery downloaded. It contains unencrypted private keys; keep it private.'
      } catch (e) { error.value = e.message }
    }
    async function restore(event) {
      const file = event.target.files?.[0]; event.target.value = ''
      if (!file) return
      if (file.size > 2e6) { error.value = 'Choose a recovery JSON file under 2 MB.'; return }
      busy.value = true; watching.value = false; error.value = ''
      try { active.value = await sharer.importRecovery(JSON.parse(await file.text())); await loadSessions(); qrData = ''; await renderQr(); notice.value = 'Recovery loaded. Review the frozen recipients below, then Resume automatic sharing.' }
      catch (e) { error.value = e.message }
      finally { busy.value = false }
    }
    async function cleanup() {
      if (!confirm('Delete the local temporary key? Only continue after checking all shares. Never send to this temporary address again. Downloaded recovery files keep their own copies.')) return
      busy.value = true
      try { active.value = await sharer.cleanup(active.value.id); watching.value = false; await loadSessions() } catch (e) { error.value = e.message } finally { busy.value = false }
    }
    async function toggleWatching() {
      try { active.value = await sharer.setPaused(active.value.id, watching.value); watching.value = !active.value.paused; if (watching.value) await check(); await loadSessions() } catch (e) { error.value = e.message }
    }
    async function shareLate() {
      busy.value = true
      try { active.value = await sharer.shareLateFunds(active.value.id); watching.value = true; await check() } catch (e) { error.value = e.message } finally { busy.value = false }
    }
    onMounted(async () => {
      try {
        await loadSessions()
        // Resume ALL retained requests, including an older request hidden by a newer one.
        const retained = sessions.value.filter(s => !s.cleanedAt)
        if (retained.length) { active.value = retained[0]; watching.value = !active.value.paused; await renderQr(); await check() }
        else { await setCount(); await refreshFees() }
        ready.value = true
        const run = async () => {
          if (document.visibilityState !== 'visible' || checking.value || busy.value) return
          await check()
          // Other previously authorized local requests continue even when not selected.
          for (const r of sessions.value.filter(s => !s.cleanedAt && !s.paused && s.id !== active.value?.id)) { try { await sharer.tick(r.id) } catch (e) { error.value = e.message } }
          await loadSessions()
        }
        pollTimer = setInterval(run, 20000)
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run() })
      } catch (e) { error.value = e.message; ready.value = true }
    })
    return { network, count, recipients, amount, unit, preference, maxFeeRate, maxFeePercent, policy, fees, price, estimate, estimateError, error, notice, sessions, active, busy, checking, ready, mainnetConsent, watching, qr, recoveryFile, target, percentages, explorer, uri, liveNetwork, step, sat, short, btc, setCount, refreshFees, create, check, selectSession, newRequest, copy, backup, restore, cleanup, shareLate, toggleWatching, testRows, testSelected, forwardDestination, forwardPreference, forwardMaxRate, forwardMaxPercent, forwardPlan, forwardSaved, forwardBusy, forwardError, refreshTestPurses, testToolsOpen, previewForward, sendForward }
  },
}).mount('#app')
