# Satoshi

- Source page: https://www.fontshare.com/fonts/satoshi
- Official download API: https://api.fontshare.com/v2/fonts/download/satoshi
- License: Fontshare Free Font License (FFL), included in `FFL.txt`
- License reference: https://www.fontshare.com/licenses/itf-ffl
- Package SHA-256: `1a018e1d986cd6b4d5768c35420e8c3a7e2119d7599c5c095553a5d19759835a`
- `Satoshi-Variable.woff2` SHA-256: `e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f`

Development and production builds run `scripts/ensure-fonts.mjs`. It downloads the original variable WOFF2 directly from Fontshare, checks the SHA-256 above, and caches it locally. The browser serves this file from Sprout, with no runtime font CDN request. Font binaries are excluded from Git; the build needs network access only when its cached file is missing or invalid.
