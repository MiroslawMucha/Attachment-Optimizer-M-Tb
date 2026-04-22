# Build Instructions

## Extension source code

All extension code (`background.js`, `compose_script.js`, `ui/toast.css`, `assets/`) is plain,
unminified JavaScript/CSS. No build step is required for the extension code itself.

## Third-party libraries (minified, open-source)

The `libs/` directory contains three open-source libraries downloaded from public CDNs:

| File | Library | Version | License | Source URL |
|------|---------|---------|---------|------------|
| `libs/pdf.min.js` | PDF.js | 3.11.174 | Apache 2.0 | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js |
| `libs/pdf.worker.min.js` | PDF.js worker | 3.11.174 | Apache 2.0 | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js |
| `libs/pdf-lib.min.js` | pdf-lib | 1.17.1 | MIT | https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js |

## How to build the .xpi

### Requirements
- Any OS with `curl` and `zip` (or any zip tool)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/MiroslawMucha/Attachment-Optimizer-M-Tb
cd Attachment-Optimizer-M-Tb

# 2. Download third-party libraries
mkdir -p libs
curl -L "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" -o libs/pdf.min.js
curl -L "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" -o libs/pdf.worker.min.js
curl -L "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js" -o libs/pdf-lib.min.js

# 3. Package as .xpi
zip -r attachment-optimizer.xpi manifest.json background.js compose_script.js ui/ assets/ libs/ scripts/
```

The resulting `attachment-optimizer.xpi` is identical to the submitted file.
