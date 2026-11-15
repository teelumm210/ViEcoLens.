"""Chuyển models/best_waste.pt (YOLOv8m, 8 lớp chất liệu) -> models/waste_384_fp16.onnx cho trình duyệt.

Cần: pip install ultralytics onnx onnxslim   (và PyTorch)
Chạy: python tools/export_waste_model.py models/best_waste.pt models/waste_384_fp16.onnx

- Xuất ONNX opset 13, vào 384x384 (mô hình huấn luyện ở 512; 384 cho độ chính xác tương đương trên bộ ảnh thử nhưng nhanh hơn ~1,7 lần).
- Lưu trọng số dạng fp16 + nút Cast về fp32: file nhỏ một nửa (~52 MB thay vì ~103 MB), tính toán trong trình duyệt vẫn là fp32.
  (Đã thử nén int8: độ chính xác hỏng nên không dùng.)
"""
import sys, shutil, numpy as np, onnx
from onnx import numpy_helper, helper, TensorProto
from ultralytics import YOLO

src, dst = sys.argv[1], sys.argv[2]
tmp = YOLO(src).export(format='onnx', imgsz=384, opset=13, simplify=True, dynamic=False, half=False)

m = onnx.load(tmp)
g = m.graph
new_init, casts = [], []
for t in g.initializer:
    if t.data_type == TensorProto.FLOAT and int(np.prod(t.dims) if len(t.dims) else 1) >= 64:
        h16 = numpy_helper.to_array(t).astype(np.float16)
        if np.isfinite(h16).all():
            name16 = t.name + '__fp16'
            new_init.append(numpy_helper.from_array(h16, name16))
            casts.append(helper.make_node('Cast', [name16], [t.name], to=TensorProto.FLOAT, name='cast_' + t.name))
            continue
    new_init.append(t)
del g.initializer[:]; g.initializer.extend(new_init)
nodes = list(g.node); del g.node[:]; g.node.extend(casts + nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
print('Đã lưu', dst, '- lớp:', YOLO(src).names)
