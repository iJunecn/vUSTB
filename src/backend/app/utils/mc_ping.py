"""Minecraft Java/Bedrock 服务器状态查询。

迁移自 USTB-Official-Backend/app/utils/serverStatus.py，移除了未用日志格式与
本项目用不到的 DNS SRV 自动探测，保持并发 Java/Bedrock 双探测的核心能力。
"""
from __future__ import annotations

import json
import re
import socket
import struct
import threading
import time
from typing import Any

JAVA_DEFAULT_PORT = 25565
BEDROCK_DEFAULT_PORT = 19132
DEFAULT_TIMEOUT_MS = 2500


# ---------- 二进制工具 ----------
def _varint(b: bytes, off: int = 0) -> tuple[int, int]:
    res = 0
    for i in range(5):
        if off + i >= len(b):
            raise IndexError
        byte = b[off + i]
        res |= (byte & 0x7F) << (7 * i)
        if not byte & 0x80:
            return res if res < (1 << 31) else res - (1 << 32), i + 1
    raise ValueError("VarInt too big")


def _pack_varint(v: int) -> bytes:
    v &= 0xFFFFFFFF
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        out.append(b | (0x80 if v else 0))
        if not v:
            return bytes(out)


def _pack_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return _pack_varint(len(b)) + b


def _pkt(pid: int, data: bytes) -> bytes:
    body = _pack_varint(pid) + data
    return _pack_varint(len(body)) + body


def _strip_format_codes(value: str) -> str:
    return re.sub(r"§[0-9a-fk-or]", "", value, flags=re.IGNORECASE)


def _extract_plain_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _strip_format_codes(value)
    if isinstance(value, list):
        return "".join(_extract_plain_text(item) for item in value)
    if isinstance(value, dict):
        parts: list[str] = []
        if "text" in value:
            parts.append(_extract_plain_text(value.get("text")))
        if "extra" in value:
            parts.append(_extract_plain_text(value.get("extra")))
        return "".join(parts)
    return _strip_format_codes(str(value))


def _ping_java(host: str, port: int, timeout_ms: int) -> dict[str, Any]:
    start = time.time()
    with socket.create_connection((host, port), timeout=timeout_ms / 1000) as s:
        hs = _pack_varint(-1) + _pack_str(host) + struct.pack(">H", port) + _pack_varint(1)
        s.sendall(_pkt(0x00, hs))
        s.sendall(_pkt(0x00, b""))
        raw = b""
        deadline = time.time() + timeout_ms / 1000
        while time.time() < deadline:
            chunk = s.recv(4096)
            if not chunk:
                break
            raw += chunk
            try:
                ln, o1 = _varint(raw, 0)
                if len(raw) - o1 >= ln:
                    _pid, o2 = _varint(raw, o1)
                    sln, o3 = _varint(raw, o1 + o2)
                    if len(raw) >= o1 + o2 + o3 + sln:
                        data = json.loads(raw[o1 + o2 + o3 : o1 + o2 + o3 + sln])
                        data["_total_ms"] = int((time.time() - start) * 1000)
                        return data
            except (IndexError, ValueError):
                continue
        raise TimeoutError("java ping timeout while reading response")


def _ping_bedrock(host: str, port: int, timeout_ms: int) -> dict[str, Any]:
    start = time.time()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(timeout_ms / 1000)
        MAGIC = bytes.fromhex("00ffff00fefefefefdfdfdfd12345678")
        ping_id = int(time.time() * 1000) & 0xFFFFFFFFFFFFFFFF
        buf = (
            b"\x01"
            + struct.pack(">Q", ping_id)
            + MAGIC
            + bytes.fromhex("1234567800")
            + struct.pack(">Q", 0)
        )
        s.sendto(buf, (host, port))
        data, _ = s.recvfrom(2048)
        if not data or data[0] not in (0x1C, 0x1D):
            raise ValueError("bad bedrock response")
        off = 33  # 1(id) + 8(ping_id) + 8(server_id) + 16(magic)
        name_len = struct.unpack_from(">H", data, off)[0]
        off += 2
        name = data[off : off + name_len].decode("utf-8", errors="ignore")
        parts = (name + ";" * 9).split(";")[:9]
        return {
            "advertise": name,
            "name": parts[1] or name,
            "version": parts[3] or None,
            "currentPlayers": parts[4] or None,
            "maxPlayers": parts[5] or None,
            "_total_ms": int((time.time() - start) * 1000),
        }


def _parse_host_port(address: str, default_port: int) -> tuple[str, int]:
    s = address.strip()
    if s.startswith("["):  # [ipv6]:port
        end = s.index("]")
        host = s[1:end]
        rest = s[end + 1 :]
        if rest.startswith(":") and rest[1:].isdigit():
            return host, int(rest[1:])
        return host, default_port
    if s.count(":") == 1:
        host, port_s = s.split(":", 1)
        if port_s.isdigit():
            return host, int(port_s)
    return s, default_port


def query_server_status(
    address: str,
    *,
    server_type: str = "auto",
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> dict[str, Any]:
    """同步查询 MC 服务器状态。返回统一格式 dict。

    server_type: "auto" | "java" | "bedrock"
    """
    start = int(time.time() * 1000)
    java_host, java_port = _parse_host_port(address, JAVA_DEFAULT_PORT)
    bed_host, bed_port = _parse_host_port(address, BEDROCK_DEFAULT_PORT)

    results: dict[str, Any] = {}
    done = threading.Event()

    def runner(kind: str, host: str, port: int, fn):
        if server_type not in (kind, "auto"):
            return
        try:
            data = fn(host, port, timeout_ms)
            if done.is_set():
                return
            results.update(type=kind, data=data, host=host, port=port)
            done.set()
        except Exception:
            return

    threads = [
        threading.Thread(target=runner, args=("java", java_host, java_port, _ping_java)),
        threading.Thread(target=runner, args=("bedrock", bed_host, bed_port, _ping_bedrock)),
    ]
    for t in threads:
        t.start()
    done.wait(timeout_ms / 1000 + 0.2)
    for t in threads:
        if t.is_alive():
            t.join(0.01)

    if not results:
        return {
            "status": "offline",
            "type": "unknown",
            "host": address,
            "delay_ms": int(time.time() * 1000) - start,
        }

    if results["type"] == "java":
        d = results["data"]
        return {
            "status": "online",
            "type": "java",
            "host": f"{results['host']}:{results['port']}",
            "motd": _extract_plain_text(d.get("description")),
            "version": (d.get("version") or {}).get("name"),
            "protocol": (d.get("version") or {}).get("protocol"),
            "players": {
                "online": (d.get("players") or {}).get("online"),
                "max": (d.get("players") or {}).get("max"),
                "sample": [
                    p.get("name") for p in (d.get("players") or {}).get("sample", []) if p.get("name")
                ],
            },
            "favicon": d.get("favicon"),
            "delay_ms": int(time.time() * 1000) - start,
        }

    d = results["data"]
    return {
        "status": "online",
        "type": "bedrock",
        "host": f"{results['host']}:{results['port']}",
        "motd": _extract_plain_text(d.get("name")),
        "version": d.get("version"),
        "players": {
            "online": int(d["currentPlayers"]) if d.get("currentPlayers", "").isdigit() else None,
            "max": int(d["maxPlayers"]) if d.get("maxPlayers", "").isdigit() else None,
            "sample": [],
        },
        "favicon": None,
        "delay_ms": int(time.time() * 1000) - start,
    }
