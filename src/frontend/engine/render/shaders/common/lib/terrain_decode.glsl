/**
 * @file terrain_decode.glsl
 * @brief terrain.compact.v2 顶点解码公共函数
 *
 * 集中维护地形压缩顶点格式的解码逻辑, 包括 SNORM8 法线、UNORM4x8 颜色、
 * 安全归一化以及 world UV / packed UV 的统一解析。
 *
 * 编码参考: `world/core/src/mesher/encoding/terrain_compact.rs`
 * 约定参考: `world/docs/CONVENTIONS.md`
 */

// ── SNORM8 法线解码 ─────────────────────────────────────────────────────────

float decodeSnorm8(uint packed, uint shift) {
    uint raw = (packed >> shift) & 0xFFu;
    int signedRaw = int(raw);
    if (signedRaw >= 128) {
        signedRaw -= 256;
    }
    return max(float(signedRaw) / 127.0, -1.0);
}

vec3 decodeNormal3x8(uint packed) {
    return vec3(
        decodeSnorm8(packed, 0u),
        decodeSnorm8(packed, 8u),
        decodeSnorm8(packed, 16u)
    );
}

// ── UNORM 4×8 颜色解码 ───────────────────────────────────────────────────────

vec4 decodeUnorm4x8(uint packed) {
    return vec4(
        float(packed & 0xFFu),
        float((packed >> 8) & 0xFFu),
        float((packed >> 16) & 0xFFu),
        float((packed >> 24) & 0xFFu)
    ) / 255.0;
}

// ── 安全归一化 ───────────────────────────────────────────────────────────────

vec3 safeNormalize(vec3 value) {
    float len2 = dot(value, value);
    if (len2 > 1e-8) {
        return value * inversesqrt(len2);
    }
    return vec3(0.0, 1.0, 0.0);
}

// ── 位置解码常量 ─────────────────────────────────────────────────────────────
// 位置编码: `(value + bias) * 32`, 解码时执行 `raw * INV_POS_SCALE - bias`。

const float INV_POS_SCALE = 1.0 / 32.0;
const float POS_BIAS_X = 4.0;
const float POS_BIAS_Y = 128.0;
const float POS_BIAS_Z = 4.0;

// UV 使用 `u16 x u16` 打包, 通过 `INV_UV_SCALE` 还原。
const float INV_UV_SCALE = 1.0 / 65535.0;

// 单字节通道归一化常量。
const float INV_BYTE = 1.0 / 255.0;

// ── terrain.compact 位置解码 ────────────────────────────────────────────────

vec3 decodeTcPosition(uvec4 terrain0) {
    float px = float(terrain0.x) * INV_POS_SCALE - POS_BIAS_X;
    float py = float(terrain0.y) * INV_POS_SCALE - POS_BIAS_Y;
    float pz = float(terrain0.z) * INV_POS_SCALE - POS_BIAS_Z;
    return vec3(px, py, pz);
}

// ── terrain.compact UV / 纹理索引解码 ──────────────────────────────────────

struct TcUvInfo {
    vec2 uv;
    float textureIndex;
    bool useWorldUV;
};

TcUvInfo decodeTcUvInfo(uvec4 terrain1) {
    uint packedUV = terrain1.x;
    float u = float(packedUV & 0xFFFFu) * INV_UV_SCALE;
    float v = float((packedUV >> 16) & 0xFFFFu) * INV_UV_SCALE;
    float texIdx = float(terrain1.y & 0xFFFFu);
    bool worldUV = ((terrain1.w >> 16) & 0x1u) != 0u;
    return TcUvInfo(vec2(u, v), texIdx, worldUV);
}

// ── World UV 计算 ───────────────────────────────────────────────────────────
// 根据面法线方向从世界坐标派生平铺 UV。
// 约定: 侧面使用 `-pos.y` 作为 V，保证 V 方向向下增长。

vec2 computeWorldUV(vec3 pos, vec3 normal) {
    if (abs(normal.y) > 0.5) {
        return pos.xz;              // 顶面 / 底面
    } else if (abs(normal.x) > 0.5) {
        return vec2(pos.z, -pos.y); // 东 / 西侧面
    } else {
        return vec2(pos.x, -pos.y); // 南 / 北侧面
    }
}

// ── 最终 UV 解析 ─────────────────────────────────────────────────────────────

vec2 resolveTcUV(TcUvInfo info, vec3 pos, vec3 normal) {
    if (info.useWorldUV) {
        return computeWorldUV(pos, normal);
    }
    return info.uv;
}
