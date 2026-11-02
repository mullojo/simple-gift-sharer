# Third-party software and services

The MIT license in this repository covers this project's original code and
accompanying documentation. It does not replace dependency licenses or grant
rights to third-party trademarks, services or remotely loaded assets.

The browser loads these direct runtime libraries from CDNs:

| Library | Version | Source / license information |
| --- | --- | --- |
| bitcoin-sdk-js | 1.0.1 | https://github.com/ChrisCho-H/bitcoin-sdk-js |
| Vue | 3.5.43 | https://github.com/vuejs/core |
| Tailwind CSS browser runtime | 4.3.3 | https://github.com/tailwindlabs/tailwindcss |
| QR Code Styling | 1.9.2 | https://github.com/kozakdenys/qr-code-styling |

These projects declare MIT licenses; consult their distributed license files and
preserve required notices if you redistribute or bundle them. SDK dependencies
are bundled remotely by esm.sh and retain their respective licenses. This repo
does not vendor the downloaded SDK test bundle or CDN runtime code.

`style.css` requests DM Sans and Manrope from Google Fonts. Their font sources
include SIL Open Font License notices:

- https://github.com/google/fonts/tree/main/ofl/dmsans
- https://github.com/google/fonts/tree/main/ofl/manrope

System fonts are used if remote fonts are unavailable. If you redistribute font
files, include their original license notices.

mempool.space provides the public blockchain, fee, quote and broadcast APIs. It
is a separate service with its own availability, rate limits and policies:
https://mempool.space/docs/api/rest

The GitHub workflow uses GitHub's checkout and setup-node actions. Source:
https://github.com/actions/checkout and https://github.com/actions/setup-node.
