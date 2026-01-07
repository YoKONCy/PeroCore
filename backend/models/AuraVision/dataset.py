import os
import torch
import cv2
import json
import numpy as np
from torch.utils.data import Dataset
import random
from PIL import Image
from torchvision import transforms

class AuraVisionDataset(Dataset):
    """
    Dataset for Pero AuraVision Triplet Training
    Automatically loads (Raw, Edge, Gray) and Intent labels from vision_data directory.
    """
    def __init__(self, vision_data_dir, transform=None, mode="edge"):
        """
        Args:
            vision_data_dir: Path to 'vision_data' directory.
            transform: Custom transforms.
            mode: "edge", "gray", or "raw".
        """
        self.input_dir = os.path.join(vision_data_dir, "input")
        self.output_dir = os.path.join(vision_data_dir, "output")
        self.mode = mode
        
        # 1. Scan for valid groups (must have both image and json)
        self.samples = []
        json_files = [f for f in os.listdir(self.output_dir) if f.endswith(".json")]
        
        # Group by timestamp
        self.label_to_indices = {}
        
        for jf in json_files:
            # 匹配 pero_view_{ts}_label.json
            if not jf.startswith("pero_view_") or not jf.endswith("_label.json"):
                continue
                
            ts = jf.replace("pero_view_", "").replace("_label.json", "")
            img_name = f"pero_view_{ts}_{mode}.png"
            img_path = os.path.join(self.input_dir, img_name)
            json_path = os.path.join(self.output_dir, jf)
            
            if os.path.exists(img_path):
                try:
                    with open(json_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        label = data.get("intent", "未知")
                        # 简化标签，只取大类以提高收敛速度
                        main_label = label.split(":")[0].strip()
                        
                        idx = len(self.samples)
                        self.samples.append({
                            "ts": ts,
                            "img_path": img_path,
                            "label": main_label
                        })
                        
                        if main_label not in self.label_to_indices:
                            self.label_to_indices[main_label] = []
                        self.label_to_indices[main_label].append(idx)
                except Exception as e:
                    print(f"警告: 无法加载 {jf}: {e}")

        self.labels = list(self.label_to_indices.keys())
        print(f"加载了 {len(self.samples)} 个样本，共 {len(self.labels)} 个意图类别")

        # Default transforms for desensitized 64x64 images
        self.transform = transform or transforms.Compose([
            transforms.Resize((64, 64)),
            transforms.ToTensor(),
            transforms.RandomErasing(p=0.3, scale=(0.02, 0.1)),
            transforms.Normalize((0.5,), (0.5,))
        ])

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        # 1. Anchor
        anchor_sample = self.samples[index]
        anchor_label = anchor_sample["label"]
        anchor_img = self._load_img(anchor_sample["img_path"])
        
        # 2. Positive
        pos_indices = self.label_to_indices[anchor_label]
        if len(pos_indices) > 1:
            pos_idx = random.choice([i for i in pos_indices if i != index])
        else:
            pos_idx = index
        pos_img = self._load_img(self.samples[pos_idx]["img_path"])
        
        # 3. Negative
        other_labels = [l for l in self.labels if l != anchor_label]
        if not other_labels:
            neg_idx = index
        else:
            neg_label = random.choice(other_labels)
            neg_idx = random.choice(self.label_to_indices[neg_label])
        neg_img = self._load_img(self.samples[neg_idx]["img_path"])
        
        return anchor_img, pos_img, neg_img

    def _load_img(self, path):
        img = Image.open(path).convert('L')
        if self.transform:
            img = self.transform(img)
        return img

def get_default_transform():
    return transforms.Compose([
        transforms.RandomRotation(5),
        transforms.ColorJitter(brightness=0.2, contrast=0.2),
        transforms.ToTensor(),
        transforms.Normalize((0.5,), (0.5,))
    ])
