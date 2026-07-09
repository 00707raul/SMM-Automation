# SMM Automation Starter

Render web dashboard + local ComfyUI worker starter.

## What this includes

- Render-ready Node.js backend
- Simple dashboard for creating generation jobs
- Job queue API
- Local worker that polls Render
- Dry-run mode for testing without ComfyUI
- Flux2 Klein 4B UI workflows, 1–5 images

## Deploy to Render

1. Upload this folder to GitHub.
2. Go to Render → New → Web Service.
3. Connect GitHub repo.
4. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Add env variable:
   - `WORKER_TOKEN` = long random secret
   - `APP_BASE_URL` = your Render URL after first deploy

Or use `render.yaml`.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:10000
```

## Run the local worker

Create `.env` from `.env.example`, then:

```bash
npm run worker
```

At first keep:

```text
DRY_RUN=true
```

This lets you test Render + worker without ComfyUI.

## Connect real ComfyUI later

When ready:

1. Start ComfyUI locally: `http://127.0.0.1:8188`
2. Export API-format workflows from ComfyUI into `workflows_api/`
3. Set:

```text
DRY_RUN=false
COMFY_URL=http://127.0.0.1:8188
COMFY_INPUT_DIR=D:\Comfy-Desktop\ComfyUI-Shared\input
```

The worker will:

1. Pull queued jobs from Render.
2. Download job images.
3. Put images into ComfyUI input folder.
4. Send prompt to ComfyUI.
5. Upload final result back to Render.

## Important

The JSON files in `workflows/` are UI workflow files. For `/prompt` automation, use API-format exports in `workflows_api/`.

## Folder structure

```text
public/              dashboard
src/store.js         simple JSON job storage
server.js            Render backend
local-worker.js      local ComfyUI worker
workflows/           normal ComfyUI UI workflows
workflows_api/       exported API workflow files go here
uploads/             uploaded images
results/             generated results
```

## UI Upgrade Included

This ZIP includes the upgraded dashboard:
- scale preset buttons
- image upload previews
- progress bar and ETA
- result image preview modal
- download result button
- delete job
- clean finished history / clear all history
- 1–5 ComfyUI API workflow files in `workflows_api/`

Important: `.env` is not included for safety. Keep your existing local `.env` file or create it from `.env.example`.
