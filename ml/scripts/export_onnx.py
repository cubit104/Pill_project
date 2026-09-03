"""Export the fine-tuned CLIP visual tower to a quantized ONNX model.

Produces pill_encoder.onnx (fp32) and pill_encoder_int8.onnx (quantized,
~4x smaller, runs on onnxruntime CPU with no torch dependency), then
verifies the quantized model's output still matches torch closely.
"""

import numpy as np
import torch
import torch.nn.functional as F

import open_clip


def main() -> None:
    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained=None)
    model.load_state_dict(
        torch.load("pill_clip_finetuned.pt", map_location="cpu", weights_only=True)
    )
    model.eval()

    class VisualWrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, x):
            return F.normalize(self.m.encode_image(x), dim=-1)

    wrapper = VisualWrapper(model)
    wrapper.eval()
    dummy = torch.randn(1, 3, 224, 224)

    # Fixed batch of 1 — production identifies a single photo per request, and
    # the dynamo exporter mis-handles dynamic batch in attention reshapes.
    torch.onnx.export(
        wrapper,
        dummy,
        "pill_encoder.onnx",
        input_names=["image"],
        output_names=["embedding"],
        opset_version=18,
    )
    print("exported pill_encoder.onnx")

    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(
        "pill_encoder.onnx",
        "pill_encoder_int8.onnx",
        weight_type=QuantType.QInt8,
    )
    print("quantized -> pill_encoder_int8.onnx")

    # Verify: torch vs quantized ONNX on the same random input
    import onnxruntime as ort

    x = torch.randn(1, 3, 224, 224)
    with torch.no_grad():
        ref = wrapper(x).numpy()
    sess = ort.InferenceSession("pill_encoder_int8.onnx", providers=["CPUExecutionProvider"])
    out = sess.run(None, {"image": x.numpy()})[0]
    cos = (ref * out).sum(axis=1) / (
        np.linalg.norm(ref, axis=1) * np.linalg.norm(out, axis=1)
    )
    print(f"torch vs int8-onnx cosine agreement: {cos.min():.4f} (want > 0.99)")

    import os
    for f in ["pill_encoder.onnx", "pill_encoder_int8.onnx"]:
        print(f"{f}: {os.path.getsize(f) / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
