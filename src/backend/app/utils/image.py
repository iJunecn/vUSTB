"""PIL 图像处理：默认 Steve 头像、从皮肤截脸"""
import hashlib
import io
from pathlib import Path
from PIL import Image

from app.config import settings


# 默认 Steve 头像（简化版，16x16 像素，皮肤色块）
_STEVE_HEAD_HEX = (
    "896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a"
    "896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a896f5a"
)


def make_default_steve_head(size: int = 64) -> bytes:
    img = Image.new("RGBA", (size, size), (137, 111, 90, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def crop_head_from_skin(skin_png: bytes, size: int = 64) -> bytes:
    """从标准 64x64 Minecraft 皮肤截取头部正脸（区域 8,8 → 16,16），缩放到 size。"""
    with Image.open(io.BytesIO(skin_png)) as img:
        img = img.convert("RGBA")
        face = img.crop((8, 8, 16, 16))
        # 头盔覆盖层 32,8 → 40,16
        try:
            overlay = img.crop((40, 8, 48, 16))
            face.paste(overlay, (0, 0), overlay)
        except Exception:
            pass
        face = face.resize((size, size), Image.NEAREST)
        buf = io.BytesIO()
        face.save(buf, format="PNG")
        return buf.getvalue()


def hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_texture(data: bytes, kind: str = "skin") -> str:
    """保存材质到 textures 目录，返回文件 hash。"""
    h = hash_bytes(data)
    Path(settings.textures_directory).mkdir(parents=True, exist_ok=True)
    Path(settings.textures_directory, f"{h}.png").write_bytes(data)
    return h
