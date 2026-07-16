# BBExtract Deployment

BBExtract deploys as a static Vite site. Supabase handles auth, logs, and storage.

## Required Environment Variables

Set these locally in `.env` and in the hosting platform:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_SUPABASE_STORAGE_BUCKET=bbextract
```

Do not expose a Supabase service role key in any `VITE_` variable.

## Supabase

1. Run `supabase/schema.sql` in Supabase SQL Editor.
2. Create users in Supabase Auth.
3. Disable public signups unless you want anyone to register.
4. Add your deployed domain to Supabase Auth URL settings if you use redirects later.

## Vercel

If importing the repo, set the project root to `bbextract`.

Vercel reads `vercel.json`:

- Build command: `npm run build:static`
- Output directory: `dist`
- Framework: Vite

Add the required `VITE_SUPABASE_*` variables in Vercel Project Settings -> Environment Variables.

## Netlify

If importing the repo, set the base directory to `bbextract`.

Netlify reads `netlify.toml`:

- Build command: `npm run build:static`
- Publish directory: `dist`
- Node version: `20`

Add the required `VITE_SUPABASE_*` variables in Netlify Site configuration -> Environment variables.

## Notes

- `robots.txt`, `X-Robots-Tag`, and `noindex` headers are configured to discourage crawling.
- Security headers and immutable asset caching are configured for both Vercel and Netlify.
- The legacy Express server is not required for Vercel/Netlify static hosting.
