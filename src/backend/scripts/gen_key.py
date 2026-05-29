"""生成 RSA 密钥对，用于 Yggdrasil 材质签名与 OAuth id_token RS256 签名"""
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import settings


def generate_rsa_keypair() -> None:
    private_path = Path(settings.rsa_private_key_path)
    public_path = Path(settings.rsa_public_key_path)
    private_path.parent.mkdir(parents=True, exist_ok=True)

    if private_path.exists() and public_path.exists():
        print(f"[gen_key] keys already exist at {private_path} / {public_path}")
        return

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    private_path.write_bytes(private_pem)
    public_path.write_bytes(public_pem)
    os.chmod(private_path, 0o600)
    print(f"[gen_key] wrote {private_path} / {public_path}")


if __name__ == "__main__":
    generate_rsa_keypair()
