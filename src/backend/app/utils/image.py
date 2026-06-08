"""材质图像处理：哈希、尺寸校验、皮肤截脸、默认头像。"""
import hashlib
import struct
import io
from pathlib import Path
from typing import Tuple

from PIL import Image

from app.config import settings


# 材质哈希（基于像素数据的 SHA-256）

def compute_texture_hash(image_bytes: bytes) -> str:
    """从 PNG 字节流计算材质 Hash（规范算法：基于像素数据）。"""
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        return compute_texture_hash_from_image(img)
    except Exception:
        raise ValueError("Invalid image data")


def compute_texture_hash_from_image(img: Image.Image) -> str:
    """规范材质 Hash：基于像素数据（非文件字节）的 SHA-256。"""
    width, height = img.size
    buf = bytearray(width * height * 4 + 8)

    # 写入宽和高 (Big-Endian)
    struct.pack_into(">I", buf, 0, width)
    struct.pack_into(">I", buf, 4, height)

    pos = 8
    pixels = img.load()

    for x in range(width):
        for y in range(height):
            r, g, b, a = pixels[x, y]
            # 规范：若 Alpha 为 0，则 RGB 皆处理为 0
            if a == 0:
                r = g = b = 0
            # 写入 ARGB
            buf[pos] = a
            buf[pos + 1] = r
            buf[pos + 2] = g
            buf[pos + 3] = b
            pos += 4

    return hashlib.sha256(buf).hexdigest()


# 尺寸校验

def validate_texture_dimensions(img: Image.Image, is_cape: bool = False) -> bool:
    """验证材质尺寸是否合法。

    皮肤：宽 % 64 == 0 且 (高 == 宽 或 高 * 2 == 宽)
    披风：宽 % 64 == 0 且 高 % 32 == 0，或 宽 % 22 == 0 且 高 % 17 == 0
    """
    w, h = img.size
    if is_cape:
        return (w % 64 == 0 and h % 32 == 0) or (w % 22 == 0 and h % 17 == 0)
    else:
        return (w % 64 == 0 and h == w) or (w % 64 == 0 and h * 2 == w)


# PNG 规范化

def normalize_png(image_bytes: bytes) -> Tuple[bytes, Image.Image]:
    """规范化 PNG 图像，移除多余数据，返回 (规范化字节, PIL Image)。"""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.format != "PNG":
            raise ValueError("Image must be PNG format")
        img = img.convert("RGBA")
        output = io.BytesIO()
        img.save(output, format="PNG")
        return output.getvalue(), img
    except Exception as e:
        raise ValueError(f"Failed to normalize PNG: {str(e)}")


# 头像截取

def extract_skin_head_avatar(image_bytes: bytes, output_size: int = 256) -> bytes:
    """从皮肤中截取正脸头像（含帽子层）并输出为方形 PNG。

    支持 64x64、64x32 以及其高清等比尺寸。
    """
    try:
        skin = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    except Exception as e:
        raise ValueError(f"Invalid skin image: {str(e)}")

    width, height = skin.size
    if width < 64 or height < 32 or width % 64 != 0:
        raise ValueError("Invalid skin dimensions for avatar extraction")

    scale = width // 64
    if scale <= 0:
        raise ValueError("Invalid skin scale")

    # 基础头部正脸: (8,8)~(15,15)
    base_face = skin.crop((8 * scale, 8 * scale, 16 * scale, 16 * scale))

    # 帽子层正脸: (40,8)~(47,15) (64x64 存在；64x32 视作透明)
    if height >= 16 * scale and width >= 48 * scale:
        hat_face = skin.crop((40 * scale, 8 * scale, 48 * scale, 16 * scale))
        base_face.alpha_composite(hat_face)

    avatar = base_face.resize((output_size, output_size), Image.NEAREST)
    output = io.BytesIO()
    avatar.save(output, format="PNG")
    return output.getvalue()


def default_steve_head_avatar(output_size: int = 256) -> bytes:
    """生成默认 Steve 风格 8x8 正脸平面头像并放大输出。"""
    palette = [
        ["#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6"],
        ["#6f9fd6", "#e7c3a1", "#e7c3a1", "#e7c3a1", "#e7c3a1", "#e7c3a1", "#e7c3a1", "#6f9fd6"],
        ["#6f9fd6", "#2f2a28", "#e7c3a1", "#e7c3a1", "#e7c3a1", "#e7c3a1", "#2f2a28", "#6f9fd6"],
        ["#6f9fd6", "#2f2a28", "#e7c3a1", "#e7c3a1", "#e7c3a1", "#e7c3a1", "#2f2a28", "#6f9fd6"],
        ["#6f9fd6", "#e7c3a1", "#e7c3a1", "#d39f7d", "#d39f7d", "#e7c3a1", "#e7c3a1", "#6f9fd6"],
        ["#6f9fd6", "#e7c3a1", "#bf8b69", "#bf8b69", "#bf8b69", "#bf8b69", "#e7c3a1", "#6f9fd6"],
        ["#6f9fd6", "#e7c3a1", "#9c6b4c", "#9c6b4c", "#9c6b4c", "#9c6b4c", "#e7c3a1", "#6f9fd6"],
        ["#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6", "#6f9fd6"],
    ]

    head = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    px = head.load()
    for y in range(8):
        for x in range(8):
            color = palette[y][x].lstrip("#")
            px[x, y] = (
                int(color[0:2], 16),
                int(color[2:4], 16),
                int(color[4:6], 16),
                255,
            )

    avatar = head.resize((output_size, output_size), Image.NEAREST)
    output = io.BytesIO()
    avatar.save(output, format="PNG")
    return output.getvalue()


# 旧接口兼容

def crop_head_from_skin(skin_png: bytes, size: int = 64) -> bytes:
    """从标准 Minecraft 皮肤截取头部正脸（区域 8,8 → 16,16），缩放到 size。"""
    return extract_skin_head_avatar(skin_png, output_size=size)


def hash_bytes(data: bytes) -> str:
    """文件级 SHA-256 哈希（非规范材质哈希）。"""
    return hashlib.sha256(data).hexdigest()


def save_texture(data: bytes, kind: str = "skin") -> str:
    """保存材质到 textures 目录，返回规范材质 hash。"""
    # 规范化 + 哈希
    normalized, img = normalize_png(data)

    # 校验尺寸
    is_cape = kind.lower() == "cape"
    if not validate_texture_dimensions(img, is_cape):
        raise ValueError("Invalid texture dimensions")

    h = compute_texture_hash_from_image(img)
    Path(settings.textures_directory).mkdir(parents=True, exist_ok=True)
    Path(settings.textures_directory, f"{h}.png").write_bytes(normalized)
    return h
