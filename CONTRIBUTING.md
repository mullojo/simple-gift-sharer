# Contributing

Small, understandable changes are welcome. Open an issue for larger changes so
we can agree on scope before implementation.

## Development

- Use a current browser and a static server; see the README quick start.
- Node 22+ is needed only for development checks. No npm install is required.
- Run `npm run check` and `npm test` before submitting a change. The test runner
  downloads the pinned Bitcoin SDK from esm.sh into an OS temporary directory.
  `SDK_MODULE=file:///absolute/path/to/sdk.mjs npm test` uses an existing offline
  SDK bundle instead. Tests mock chain APIs; they must never broadcast real funds.
- For manual tests, use Testnet4 and keep recovery exports outside this repo.

## Design conventions

Keep the no-build browser workflow, native ES modules, and the separation between
the reusable `lib/` code and the Vue interface. Prefer “purse” in product wording.
Use integer sats and basis points, preserving every sat through deterministic
rounding. Mainnet and Testnet4 must remain explicitly separated.

Changes to signing, fees, persistence, recovery or cleanup need relevant tests.
Preserve the rule that signed bytes commit before broadcast, identical-byte
retry, exclusive cross-tab locks, and confirmed/empty-address cleanup guards.
Do not add real keys, recovery files, personally identifying logs or mainnet
funds to test fixtures or issue reports.

Explain the problem, resulting behavior and verification in your pull request.
Update documentation when behavior changes. Update `package.json` and the visible
version in `index.html` together for a release. Documentation-only changes do not
require a runtime version bump.

## License and security

Contributions are provided under this repository's MIT license. Dependencies
retain their own licenses. Report suspected vulnerabilities through the process
in [SECURITY.md](SECURITY.md), without exposing private keys or recovery files.

## Human value records

Follow the [Human Value Blocks guide](https://github.com/mullojo/background-removal/blob/main/docs/HUMAN_VALUE_BLOCKS_GUIDE.md)
when updating `docs/HUMAN_VALUE_BLOCKS.md`. Keep entries short and public-facing.
Estimate a period's human contribution before distributing its blocks; preserve
existing allocations and avoid counting AI runtime or overlapping work twice.
Reconcile category/square counts, ledger arithmetic, evidence, review status,
and the README summary. Ledger maintenance adds no blocks automatically.
