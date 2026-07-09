# API-format workflows go here

The files in `workflows/` are normal ComfyUI UI workflow files.
For automation through `/prompt`, ComfyUI needs API-format workflow JSON.

In ComfyUI:
1. Open the working Flux2 workflow.
2. Enable Dev Mode in settings.
3. Use **Save (API Format)** / **Export API Format**.
4. Save files here with these names:

- `flux2_1_image_api.json`
- `flux2_2_image_api.json`
- `flux2_3_image_api.json`
- `flux2_4_image_api.json`
- `flux2_5_image_api.json`

The local worker will choose the correct file based on uploaded image count.
