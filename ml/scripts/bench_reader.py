import time, torch, os
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
torch.set_num_threads(os.cpu_count() or 4)
p = TrOCRProcessor.from_pretrained("pill_trocr"); m = VisionEncoderDecoderModel.from_pretrained("pill_trocr").eval()
photos = {"aug-32":"IMG_0663.jpeg","aug-X":"IMG_0662.jpeg","jard-S10":"IMG_0661.jpg","jard-logo":"IMG_0660.jpg"}
imgs = {k: Image.open(f"C:/Users/ar/Downloads/{v}").convert("RGB") for k,v in photos.items()}
def read(img, beams):
    pv = p(images=img, return_tensors="pt").pixel_values
    with torch.no_grad(): ids = m.generate(pv, max_length=24, num_beams=beams, min_new_tokens=1, use_cache=True)
    return p.batch_decode(ids, skip_special_tokens=True)[0].strip().upper()
m.config.use_cache=True; m.generation_config.use_cache=True
for beams in (1, 2):
    t=time.time(); out={k: read(v, beams) for k,v in imgs.items()}
    print(f"beams={beams}: {out}  ({(time.time()-t)/len(imgs):.1f}s per photo)", flush=True)
