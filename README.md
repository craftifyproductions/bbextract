# BBExtract

BBExtract is a web app for unpacking Blockbench `.bbmodel` files into a cleaner set of model assets. It can process individual models or ZIP archives that contain models, textures, and JSON files.

The app runs model parsing in the browser, stores extracted files in Cloudflare R2, and keeps upload metadata and session logs in Supabase.

## What It Does

- Upload `.bbmodel` files directly.
- Upload ZIP files and extract supported contents in chunks.
- Separate extracted assets into model ZIPs, raw models, metadata, geometry, textures, animations, summaries, and standalone JSON files.
- Store files in Cloudflare R2 using server-side credentials.
- Store run history, file metadata, audit events, and model records in Supabase.
- Show processing logs and make persistence failures visible instead of silently losing data after reload.

## Stack

- React
- TypeScript
- Vite
- Express
- Supabase
- Cloudflare R2
- Tailwind CSS

## Requirements

- Node.js 20 or newer
- Supabase project
- Cloudflare R2 bucket

## Setup

Install dependencies:

```bash
npm install
```

Copy the example environment file:

```bash
cp .env.example .env
```

Fill in the Supabase and R2 values in `.env`.

Run the Supabase schema from:

```text
supabase/schema.sql
```

Start the app:

```bash
npm run dev
```

## Scripts

```bash
npm run dev
npm run build
npm run test
npm run lint
```

## Notes

Do not commit `.env`. R2 credentials are server-only and must not use the `VITE_` prefix.

Large ZIP uploads are processed in chunks so the app can keep working through bigger archives without loading every extracted file into the upload queue at once.
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
