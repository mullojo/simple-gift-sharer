# Simple gift sharer · 0.1.1

A no-build, local-first Bitcoin gift-sharing experiment. A giver funds a fresh
browser-generated address. That browser signs and broadcasts a second transaction
which divides the received funds between 2–50 recipients. No backend, account,
cloud key, or connection to the giver's purse is required.

**Start with Testnet4. Mainnet is implemented but this is an unaudited prototype.**

MIT licensed · [License](LICENSE) · [Contributing](CONTRIBUTING.md) ·
[Security model and reporting](SECURITY.md) · [Third-party software](THIRD_PARTY.md)

The browser demo runs directly from these files through any static HTTP server.
The reusable JavaScript library lives in `lib/`. No package installation or build
step is needed to use either in a browser. `package.json` is marked `private` to
prevent accidental npm publication; this does not restrict the MIT license or
making this GitHub repository public.

## Try it

From this directory:

```sh
python3 -m http.server 4175
```

Open **http://localhost:4175**. No install or build is needed. Opening the HTML
through `file://` cannot load local ES modules reliably and lacks the stable
origin needed by this draft. A `file://` page can be considered trustworthy by a
browser, but local module CORS restrictions and file-origin storage behavior
make it unsuitable for this implementation. Always use the same host and port for your
saved requests; `localhost` and `127.0.0.1` have separate browser storage.
VS Code Live Server at **http://127.0.0.1:5500/index.html** is fine. Current
browsers treat both loopback IP addresses and localhost as trustworthy contexts.
Live Server serves these static files; it is not a Bitcoin backend. Its automatic
reloads use the same saved state, although avoid editing while a send is underway.
IndexedDB is shared by pages on the same scheme/host/port, regardless of path, so
use a dedicated origin/port when isolating separate experiments.

1. Leave **Testnet4**, **2 recipients**, and **5,000 sats** selected. Two real
   Testnet4 destination addresses are generated and saved locally on first use.
   The browser holds their test keys; these are not someone else's faucet or burn
   addresses. You can paste destinations from your own purses instead.
2. Review the percentages and fee preview. Expand the fee/key controls if desired.
   Clicking **Create address & enable sharing** freezes the destinations, target,
   timing policy, and fee limits and saves the new temporary key before showing a QR.
3. **Download the recovery file before funding.** It includes the temporary key,
   request, any signed transaction, and local demo recipient keys. It is plain
   JSON containing unencrypted private keys: keep it private and outside Git.
4. Send **5,000 Testnet4 sats** from a faucet to the **temporary receive address**,
   not either recipient. Keep the page open. The QR uses the same address and
   target amount in a BIP21 URI; the copy button copies the plain address.
5. The browser checks about every 20 seconds while visible, verifies the funding
   output, gets a fresh fee, signs locally, commits the signed transaction, then
   broadcasts through mempool.space. **Check now** also advances the process.
6. Follow the split transaction link and the recipient address links. Both outputs
   should arrive together. At 1 sat/vB, one funding input and two P2WPKH outputs
   reserve 143 sats for the fee: **2,429 + 2,428 + 143 = 5,000**. Actual signed
   vsize/rate appear in the receipt. The spare sat goes deterministically to the
   first recipient when fractional entitlements tie.
7. After three split confirmations, optionally delete the local temporary key.
   Cleanup freshly checks confirmations and that no UTXOs remain. Test recipient
   keys remain separately available. The public address and receipt remain visible.

A network fee estimate is not a guarantee of inclusion or cheapest eventual fee.
The fee is paid out of the received gift **before** percentages are applied: a
$10 gross gift produces slightly less than $5 to each of two equal recipients.
The giver/faucet also pays its own first transaction fee separately. The rate
ceiling applies to the live recommendation: conservative size reservation can
make the actual signed sat/vB rate slightly higher. The total fee percentage
budget still applies to the exact reserved fee.

## What can be configured

- Testnet4 / Mainnet. Mainnet starts with empty destinations and requires an explicit
  acknowledgement of automatic signing and temporary unencrypted custody.
- 2, 3, 4, 5, 10, 20 or 50 recipients in the demo; the library accepts every count
  from 2–50. Equal default weights use basis points, e.g. 33.34/33.33/33.33.
- Custom percentages, up to two decimals, totaling exactly 100%; unique addresses.
- Native SegWit P2WPKH/P2WSH and Taproot recipients. Checksum and network checks
  happen locally. Legacy Base58 recipients are intentionally outside this draft.
- A minimum target in sats or a USD amount converted with a fresh mainnet BTC/USD
  quote. Testnet coins have no dollar value; USD is a sizing exercise there.
  The sat target freezes at address creation; this draft is not a $10 supporter
  entitlement system and does not grant supporter access by itself.
- Economy / Normal / Priority live fee recommendations, a ceiling for the recommended sat/vB rate, and a
  maximum percentage of the gift for the split fee (default 25%).
- Forward as soon as funding appears in the mempool (default), or wait for its
  first confirmation. Confirmed mode requires the confirmed subtotal to reach
  the target; unconfirmed extra deposits wait for a later round.

Every output must have at least a conservative **546 sats** after fees. For example,
5,000 sats cannot fund 50 useful shares; increase the gift or reduce the count.
The engine sweeps all eligible observed UTXOs (up to 100) in one transaction,
without a change output or coin-selection library.

## Closing, recovery, and late gifts

IndexedDB stores keys and requests in `simple-gift-sharer/records`. Unlocking is
not required in this first draft. Web Locks serialize signing and cleanup between
tabs. If a storage commit fails, a new transaction is not broadcast.

Nothing can sign while the browser is closed, suspended, or its device is asleep.
The page polls while visible and checks when you return. Open the **same origin**
to resume retained requests. Other local requests continue while you view a new
one. Pause automation is persisted per request; pausing one does not pause others.

The signed raw bytes and locally calculated txid are saved **before** broadcast.
If a response is lost, the next check looks up that txid and may rebroadcast the
identical bytes; it never automatically creates a competing replacement. Browser
reloads and simultaneous tabs therefore reuse the same transaction. The engine
checks input values/scripts against funding transactions and checks the final raw
outputs, actual vsize, fee and txid against the plan.

Restore a downloaded recovery JSON using the footer action. The app validates the
key/address, destinations, and signed transaction plan, and imports it **paused**.
Review the recipients and choose Resume. Existing local requests are not overwritten
with possibly stale exported state. Recovered demo recipient keys are validated and merged with the local demo
keys, preserving both sets when this browser has already generated its own. The separate test-recipient export is a key record,
not a gift-request recovery file.

If a late deposit is found after the first split has three confirmations, the UI
shows **Share late funds**. That explicitly enables another round using the same
shares and fee limits. Below-dust/uneconomic late funds remain held with their key,
waiting for more funding or lower fees. This is a recovery convenience: normally
create a new address for every gift.

Cleanup is deliberately manual, not scheduled. Three confirmations are not
irreversibility. A late payment can arrive just after an empty-address check, or a
chain reorganization can happen. Never reuse a retired address; retain recovery
until you are satisfied. Cleanup removes only the local private-key field, cannot
zero browser/OS storage reliably, and cannot erase downloaded files or old browser
backups. It does not delete the separate demo recipient purses.

An unconfirmed parent may be replaced (RBF), disappear, or have insufficient
package fees for its child. Mempool forwarding improves latency but cannot
promise settlement. Broadcast failures retain the signed transaction and key.
If another transaction spends a selected input, automatic forwarding stops with
an error instead of silently rebuilding. Keep recovery, inspect the explorer,
and resolve that request before reusing funds. No automatic RBF/CPFP, changed-parent
replanning, custom fee bump, or general recovery sweep is implemented in v0.1.0.
Confirmed mode avoids starting a split from an unconfirmed parent but cannot avoid
all reorganizations or fee changes.

## Forward the test-recipient funds · v0.1.1

Open **Forward test coins** below the main workspace. This panel only spends from
Testnet4 recipient keys generated and saved by this browser. It works after the
temporary gift key is cleaned up, since recipient keys are separate.

1. Refresh the test balances. Each purse shows confirmed and pending sats.
2. Select one or both purses (or more generated purses). Only confirmed outputs
   are eligible; wait for the split transaction's first confirmation.
3. Paste a Testnet4 native SegWit/Taproot destination. For returning faucet coins,
   copy the faucet's actual published return address; no return address is assumed.
4. Choose a fee preference and limits, then **Preview forward**. The review shows
   the full destination, input total, fee, and exact net amount. It expires after
   two minutes and is invalidated when selections or settings change.
5. **Send Testnet4 coins** manually signs and broadcasts one transaction. Selecting
   both split purses combines their inputs into a single output, saving overhead
   compared with two separate forwards. There is no change: all selected confirmed
   funds, less the fee, go to the chosen address. Keys remain saved.

`lib/test-purses.js` is a separate reusable helper with `balances()`,
`prepare(options)`, `send(reviewId)`, `status()`, and `retry()`. Reviews are persisted
with unique IDs, source ownership/scripts/values are rechecked, and each input is
signed by its own recipient key. Signed bytes commit before broadcast. If a reply
is lost, use **Check / retry saved forward** to resend the same bytes. A pending
forward blocks a new one until it confirms. This manual tool never spends Mainnet
funds or keys belonging to manually pasted external purse addresses.

Recovery exports already contain these generated recipient keys; keep them private.
The pending forward record stays in IndexedDB on the same origin. Recovery after
cleared storage restores keys, not the forwarding history. After import, inspect
the current chain balances before creating a new forward.

## Reuse the core

`lib/` has no Vue, Tailwind, QR, DOM, or CDN imports. Inject the SDK, storage, and
optionally the API/locking adapters. Browser Web Locks are used by default.

```js
import * as bitcoin from 'https://esm.sh/bitcoin-sdk-js@1.0.1?bundle'
import { createStore } from './lib/storage.js'
import { createSharer } from './lib/sharer.js'

const store = createStore()
const sharer = createSharer({ bitcoin, store })
const request = await sharer.create({
  network: 'testnet4',
  expectedSats: 5000,
  recipients: [
    { label: 'Project', address: projectAddress, bps: 5000 },
    { label: 'Referrer', address: referrerAddress, bps: 5000 },
  ],
  feePreference: 'economy',
  maxFeeRate: 20,
  maxFeePercent: 25,
  fundingPolicy: 'mempool',
})
// Only display request.address after create() resolves (the key has committed).
const updated = await sharer.tick(request.id)
// Call tick() periodically while the page is running; render updated.lastError.
// updated.current contains txid, raw bytes, inputs, outputs and the actual fee.
```

Other methods: `setPaused(id, boolean)`, `exportRecovery(id)`,
`importRecovery(backup)`, `shareLateFunds(id)`, `cleanup(id)`.
Storage adapter: `get(id)`, `list()`, `put(record)`; writes must resolve only after
commit, and reads/writes must return/store independent record copies. See
`mempool.js` for the injectable API interface. A lock adapter must offer the
cross-tab exclusive semantics of `navigator.locks.request(name, callback)`.

For a future supporter integration, verify the **split transaction and recipient
outputs**, not a payment to the project's old fixed address. This demo issues a
local transaction receipt, not a signed license or proof of who paid. Local code
can be modified by its user; a local-only referral program is an honor system.

## Files and dependencies

- `index.html`, `style.css`, `app.js`: demo UI and polling controller.
- `deps.js`: pinned Bitcoin SDK 1.0.1 via esm.sh; Vue 3.5.43 via jsDelivr.
- Tailwind CSS browser 4.3.3 and QR Code Styling 1.9.2 via jsDelivr.
- `lib/sharer.js`: temporary-key and transaction lifecycle.
- `lib/math.js`: exact sat allocations, conservative size estimates, fee/dust limits.
- `lib/transaction.js`: signed-transaction parser, plan verification, txid derivation.
- `lib/mempool.js`: REST adapter for mainnet/Testnet4 and shared BTC/USD quotes.
- `lib/storage.js`: IndexedDB adapter which awaits transaction completion.

No model, seed phrase, BIP32 tree, passkey, secretbox vault, service worker, or server
is needed here. Fresh SDK-generated keys replace the Orange Purse's long-term
vault. No private key is intentionally sent to mempool.space. Its API sees the
public addresses, transaction lookups, IP address and broadcast bytes. Third-party
CDN scripts execute in this origin and are part of the trust boundary; pinning
package versions is not an audit or a guarantee of transitive code immutability.
No offline mode is provided. Photos, other project data and other origins' purses
are not involved.

## Verification

Node 22+ is used only for development tests; the browser app needs no Node install.

```sh
npm run check
npm test
# or node scripts/test.mjs
```

The runner fetches the pinned SDK bundle into an OS temporary directory, runs real
key-generation/signing tests with simulated chain APIs, and deletes its temporary
file. It does not send coins. For a predownloaded offline bundle:

```sh
SDK_MODULE=file:///absolute/path/to/sdk.mjs node scripts/test.mjs
```

The tests also verify forwarding from two distinct keys, individual source
selection, unconfirmed-fund blocking, wrong-network rejection, fee changes,
failed commits, concurrent sends, and identical-byte retry.

The tests cover share rounding/conservation, fees/dust, actual signed outputs and
transaction IDs, broadcast uncertainty, failed storage commits, cross-tab locking,
confirmation policy, late funding, cleanup guards, and portable recovery.
All 21 checks passed against SDK 1.0.1 during this draft. Browser smoke checks
covered live Testnet4 fees/quotes, QR/address creation, persisted pause after
reload, Mainnet empty destinations/consent, 3/50-way setup, and desktop/390 px
layouts without horizontal overflow. A subsequent live Testnet4 round trip succeeded: a 5,000-sat faucet payment
and its automatic split confirmed in the same block. The two recipient outputs
were then combined into a confirmed return transaction. The split paid 143 sats
and the return paid 182 sats, returning 4,675 sats. This is one successful network
test, not a security audit. Live temporary-key cleanup remains unverified.

GitHub Actions runs syntax checks and the SDK-backed tests on pushes and pull
requests. Tests use simulated chain APIs and never send bitcoin. See
[repository setup](REPOSITORY_SETUP.md) to publish your own copy using GitHub Desktop.

Primary references:
[Bitcoin SDK](https://github.com/ChrisCho-H/bitcoin-sdk-js),
[mempool API](https://mempool.space/docs/api/rest),
[Esplora HTTP API](https://github.com/Blockstream/esplora/blob/master/API.md),
[BIP21](https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki),
[QR Code Styling](https://github.com/kozakdenys/qr-code-styling).
