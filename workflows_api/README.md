# API Workflows

These JSON files are sent directly to the ComfyUI `/prompt` API by `local-worker.js`.

- `face_swap_api.json` — fixed-prompt Face Swap workflow
- `flux2_1_image_api.json` to `flux2_5_image_api.json` — FLUX workflows
- `z_image_base_img2img_2image_api.json` — Z-Image two-image workflow
- `z_image_base_text2image_api.json` — Z-Image text workflow

For Face Swap, website upload order is Reference first and Your model second. The worker maps Your model to workflow node 12 and Reference to node 13.
