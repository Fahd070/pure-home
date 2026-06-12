# Deploying Pure Home Web to Vercel

## One-time setup

1. Go to https://vercel.com → New Project → Import from GitHub → select `Fahd070/pure-home`
2. In the "Configure Project" screen:
   - **Root Directory**: `packages/web`
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Add Environment Variable:
   - Key: `VITE_API_URL`
   - Value: `https://wfm-system.onrender.com`
4. Click **Deploy**

That's it — Vercel deploys in ~30 seconds.

## Add your domain (optional)

In Vercel → Project Settings → Domains, add `portal.purehome.sa` or `app.purehome.sa`.
Vercel provides free SSL automatically.

## Update backend CORS

After you get your Vercel URL (e.g. `https://purehome.vercel.app`), set this
environment variable on Render (backend):

```
ALLOWED_ORIGINS=https://purehome.vercel.app
```

If you have a custom domain:
```
ALLOWED_ORIGINS=https://portal.purehome.sa,https://purehome.vercel.app
```

Go to Render → pure-home backend service → Environment → add `ALLOWED_ORIGINS`.
The backend will restart automatically.

## Future deployments

Every `git push origin main` automatically re-deploys via Vercel CI/CD.
No manual steps needed after the initial setup.
