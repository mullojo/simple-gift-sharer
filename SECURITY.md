# Security model and reporting

This is an experimental Bitcoin tool, not an audited custody product. Only the
current source revision is maintained. Start with Testnet4; the completed test
round trip does not establish Mainnet custody safety.

## Trust boundaries

- Private keys are generated and transactions signed in the browser. This draft
  saves keys unencrypted in IndexedDB and exports unencrypted recovery JSON.
- A compromised origin, CDN script, browser extension, device or browser profile
  can obtain keys or change transaction instructions. Dependencies load from
  third-party CDNs. Package version pinning does not pin every transitive byte.
- Browser data belongs to an origin (scheme, host and port), shared across paths.
  Use an isolated origin when testing projects. Never rely on a browser data copy
  as the only recovery method.
- mempool.space supplies balances, UTXOs, transaction status, fee recommendations,
  quotes and broadcast. Its responses are not independently verified against a
  local Bitcoin node. It sees public address queries and network metadata.
- Mempool acceptance is provisional. Parents can be replaced, transactions can be
  dropped, miners can delay inclusion, and chains can reorganize. Three
  confirmations are a cleanup policy, not mathematical irreversibility.
- The browser cannot work while closed or suspended. Recovery and signed-byte
  persistence support resumption; no server stays awake for the giver.
- Key cleanup cannot guarantee secure erasure of JavaScript memory, IndexedDB
  storage media, browser backups or downloaded recovery copies. Never reuse a
  retired address; late deposits can arrive after an empty-address check.
- A local-only referral/giving program cannot prove payer identity or enforce
  business rules against someone who modifies their client.

## Report a vulnerability

If the repository's **Security → Advisories → Report a vulnerability** action is
available, use it for a private report. The maintainer should enable GitHub private
vulnerability reporting when publishing this repository. If it is unavailable,
open a minimal issue asking for a private reporting channel; omit exploit details
until a private channel is established.

Include the affected version, expected/actual behavior, browser environment and
reproduction steps using disposable Testnet4 keys. Never include a private key,
seed, recovery file or access credential. Do not send Mainnet funds to demonstrate
an issue. Public addresses and transaction IDs may reveal financial activity;
share only what is necessary for the report.
