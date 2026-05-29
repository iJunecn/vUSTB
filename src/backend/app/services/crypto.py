"""RSA 签名、JWKS、id_token RS256 工具"""
import base64
import hashlib
import jwt
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key

from app.config import settings


class CryptoUtils:
    def __init__(self) -> None:
        self._private_key: rsa.RSAPrivateKey | None = None
        self._public_key: rsa.RSAPublicKey | None = None

    def _load(self) -> None:
        if self._private_key is None:
            data = Path(settings.rsa_private_key_path).read_bytes()
            self._private_key = load_pem_private_key(data, password=None)
        if self._public_key is None:
            data = Path(settings.rsa_public_key_path).read_bytes()
            self._public_key = load_pem_public_key(data)

    @property
    def public_pem(self) -> str:
        self._load()
        pem = self._public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")
        return pem

    @property
    def public_pem_oneline(self) -> str:
        """Yggdrasil meta 端点要求的单行格式（带 PEM header/footer 但去除换行内联）"""
        return self.public_pem

    def sign_data(self, data: str) -> str:
        """SHA1withRSA 签名（Yggdrasil texture 签名要求 SHA1）"""
        self._load()
        sig = self._private_key.sign(
            data.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA1(),
        )
        return base64.b64encode(sig).decode("utf-8")

    def jwks(self) -> dict[str, Any]:
        self._load()
        numbers = self._public_key.public_numbers()
        n = numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big")
        e = numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, "big")
        kid = hashlib.sha256(n).hexdigest()[:16]
        return {
            "keys": [
                {
                    "kty": "RSA",
                    "use": "sig",
                    "alg": "RS256",
                    "kid": kid,
                    "n": base64.urlsafe_b64encode(n).rstrip(b"=").decode("ascii"),
                    "e": base64.urlsafe_b64encode(e).rstrip(b"=").decode("ascii"),
                }
            ]
        }

    def sign_id_token(self, claims: dict[str, Any], ttl_seconds: int = 3600) -> str:
        self._load()
        now = int(datetime.now(timezone.utc).timestamp())
        claims = dict(claims)
        claims.setdefault("iat", now)
        claims.setdefault("exp", now + ttl_seconds)
        return jwt.encode(claims, self._private_key, algorithm="RS256")


crypto = CryptoUtils()
