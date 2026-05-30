#version 300 es

#ifndef GEOMETRY_ALPHA_TEST
#define GEOMETRY_ALPHA_TEST 1
#endif

/**
 * @file geometry.fsh
 * @brief 几何阶段片元着色器 (G-Buffer 填充)
 *
 * 输入：相机空间顶点属性 (Pos、Normal、UV、Light)
 * 输出：G-Buffer 多渲染目标 (Albedo+Emit / Normal / PBR+Light / LinearDepth)
 * 特性：视差遮蔽 (POM)、LabPBR 解码、半透明材质参数调制
 */

precision highp float;
precision highp sampler2DArray;

// Inputs 输入属性
in vec3 vNormal;              // 世界空间法线
in vec2 vUV;                  // 纹理坐标
in vec3 vColor;               // 顶点颜色
in vec3 vPosition;            // 相机相对位置 (camera-relative)
in float vViewDepth;          // 线性视空间深度 (meters)
flat in float vTextureIndex;  // 纹理索引
in float vEmission;           // 自发光
in float vBlockLight;         // 方块光
in float vSkyLight;           // 天空光
flat in uint vMaterialId;     // 半透明材质 ID
in vec2 vDebugUV;             // Debug UV
flat in float vUseWorldUV;    // 1.0 = greedy/world-uv mesh

// G-Buffer Outputs G-Buffer输出
layout(location = 0) out vec4 gRT0;  // RGB: Albedo, A: Emission
layout(location = 1) out vec4 gRT1;  // RGB: Normal, A: Unused
layout(location = 2) out vec4 gRT2;  // R: Roughness, G: Metallic, B: SkyLight, A: BlockLight
layout(location = 3) out vec4 gRT3;  // RG: packed linear depth (16-bit), BA unused

// Uniforms 全局变量
uniform vec3 uBaseColor;
uniform float uRoughness;
uniform float uMetallic;
uniform float uShowDebugBorders;        // New Uniform: 0.0 = Off, 1.0 = On
uniform float uShowLightNumbers;        // 0.0 = Off, 1.0 = On
uniform float uShowVariantIndices;      // 0.0 = Off, 1.0 = On
#if GEOMETRY_ALPHA_TEST
uniform float uDebugCutout;             // 0.0 = Off, 1.0 = On (debug cutout pass)
uniform float uAlphaCutoff;             // 0.0 = disable discard, >0 enables alpha test
#endif
uniform sampler2DArray uTextureArray;   // 漫反射纹理
uniform sampler2DArray uNormalArray;    // 法线/高度纹理
uniform sampler2DArray uSpecularArray;  // LabPBR 材质纹理
uniform bool uHasSpecularMap;
uniform bool uHasNormalMap;
uniform bool uHasTexture;
uniform float uNormalScale;
// uniform vec3 uViewPos;
uniform float uParallaxDepth;
uniform float uEnableParallaxSelfShadow; // 0.0 = Off, 1.0 = On
// Variant LUT (Random Variants)
uniform sampler2D uVariantLUT;

// Linear depth write control
uniform bool uWriteLinearDepth;

// ----------------------------------------------------------------------------
// Hashing for Random Variants (integer-only; stable across platforms)
// ----------------------------------------------------------------------------
uint hash_u32(uint x) {
    x ^= x >> 16u;
    x *= 0x7feb352du;
    x ^= x >> 15u;
    x *= 0x846ca68bu;
    x ^= x >> 16u;
    return x;
}

uint hash3i(ivec3 p) {
    // Mix coordinates with distinct odd primes, then avalanche.
    uint x = uint(p.x) * 73856093u;
    uint y = uint(p.y) * 19349663u;
    uint z = uint(p.z) * 83492791u;
    return hash_u32(x ^ y ^ z);
}

uniform float uCameraFar;

layout(std140) uniform CameraUniforms {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    mat4 uInverseViewProj;
    vec4 uViewPos;
};

#include "lib/pbr.glsl"

struct TranslucentMaterialParams {
    float roughnessScale;
    float alphaScale;
    float minCoverage;
    float specularCoverage;
    vec3 colorScale;
};

TranslucentMaterialParams makeTranslucentParams(float roughnessScale, float alphaScale, float minCoverage, float specularCoverage, vec3 colorScale) {
    TranslucentMaterialParams params;
    params.roughnessScale = roughnessScale;
    params.alphaScale = alphaScale;
    params.minCoverage = minCoverage;
    params.specularCoverage = specularCoverage;
    params.colorScale = colorScale;
    return params;
}

TranslucentMaterialParams getTranslucentMaterialParams(uint id) {
    if (id == 1u) {
        return makeTranslucentParams(0.2, 1.1, 0.05, 0.85, vec3(1.0));
    } else if (id == 2u) {
        TranslucentMaterialParams params;
        params.roughnessScale = 0.35;
        params.alphaScale = 1.2;
        params.minCoverage = 0.05;
        params.specularCoverage = 0.9;
        params.colorScale = vec3(1.4);
        return params;
    } else if (id == 3u) {
        return makeTranslucentParams(0.55, 0.9, 0.2, 0.45, vec3(1.0));
    } else if (id == 6u) {
        return makeTranslucentParams(1.2, 0.7, 0.0, 0.25, vec3(0.9, 1.02, 0.9));
    } else if (id == 7u) {
        return makeTranslucentParams(1.1, 0.65, 0.0, 0.2, vec3(1.05, 0.92, 0.75));
    }
    return makeTranslucentParams(1.0, 1.0, 0.0, 0.2, vec3(1.0));
}

vec2 packUnorm16(float v01) {
    v01 = clamp(v01, 0.0, 1.0);
    float u = floor(v01 * 65535.0 + 0.5);
    float hi = floor(u / 256.0);
    float lo = u - hi * 256.0;
    return vec2(hi, lo) / 255.0;
}

float rectMask(vec2 uv, vec2 minP, vec2 maxP) {
    vec2 inMin = step(minP, uv);
    vec2 inMax = step(uv, maxP);
    return inMin.x * inMin.y * inMax.x * inMax.y;
}

float edgeMask(vec2 uv01, float width) {
    float d = min(min(uv01.x, 1.0 - uv01.x), min(uv01.y, 1.0 - uv01.y));
    return 1.0 - step(width, d);
}

int digitMask(int d) {
    if (d == 0) return 63;
    if (d == 1) return 6;
    if (d == 2) return 91;
    if (d == 3) return 79;
    if (d == 4) return 102;
    if (d == 5) return 109;
    if (d == 6) return 125;
    if (d == 7) return 7;
    if (d == 8) return 127;
    if (d == 9) return 111;
    return 0;
}

float sevenSegDigit(vec2 uv, int d) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;

    int mask = digitMask(d);
    float s = 0.0;

    // 0: top, 1: upper-right, 2: lower-right, 3: bottom, 4: lower-left, 5: upper-left, 6: middle
    if ((mask & 1) != 0)   s = max(s, rectMask(uv, vec2(0.20, 0.86), vec2(0.80, 0.98)));
    if ((mask & 2) != 0)   s = max(s, rectMask(uv, vec2(0.82, 0.54), vec2(0.94, 0.94)));
    if ((mask & 4) != 0)   s = max(s, rectMask(uv, vec2(0.82, 0.08), vec2(0.94, 0.48)));
    if ((mask & 8) != 0)   s = max(s, rectMask(uv, vec2(0.20, 0.02), vec2(0.80, 0.14)));
    if ((mask & 16) != 0)  s = max(s, rectMask(uv, vec2(0.06, 0.08), vec2(0.18, 0.48)));
    if ((mask & 32) != 0)  s = max(s, rectMask(uv, vec2(0.06, 0.54), vec2(0.18, 0.94)));
    if ((mask & 64) != 0)  s = max(s, rectMask(uv, vec2(0.20, 0.46), vec2(0.80, 0.58)));

    return s;
}

float decimalValueMask(vec2 uv, int value) {
    int clamped = clamp(value, 0, 15);
    int tens = clamped / 10;
    int ones = clamped - tens * 10;

    vec2 uvT = (uv - vec2(0.02, 0.0)) / vec2(0.46, 1.0);
    vec2 uvO = (uv - vec2(0.52, 0.0)) / vec2(0.46, 1.0);

    float m = sevenSegDigit(uvO, ones);
    if (tens > 0) {
        m = max(m, sevenSegDigit(uvT, tens));
    }
    return m;
}

float segmentMask(vec2 uv, vec2 a, vec2 b, float halfWidth) {
    vec2 pa = uv - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float d = length(pa - ba * h);
    return 1.0 - step(halfWidth, d);
}

// dir: 0=up, 1=right, 2=down, 3=left
float arrowMask(vec2 uv, int dir) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;

    vec2 q = uv - vec2(0.5);
    if (dir == 1) q = vec2(q.y, -q.x);
    else if (dir == 2) q = -q;
    else if (dir == 3) q = vec2(-q.y, q.x);
    q += vec2(0.5);

    // Up arrow in local space: one stem + two head strokes.
    float stem = segmentMask(q, vec2(0.50, 0.16), vec2(0.50, 0.70), 0.07);
    float headL = segmentMask(q, vec2(0.50, 0.70), vec2(0.30, 0.50), 0.07);
    float headR = segmentMask(q, vec2(0.50, 0.70), vec2(0.70, 0.50), 0.07);
    return max(stem, max(headL, headR));
}

int decodeByte01(float v) {
    return int(floor(v * 255.0 + 0.5));
}

int decodeU16RG(vec4 v) {
    int hi = decodeByte01(v.r);
    int lo = decodeByte01(v.g);
    return hi * 256 + lo;
}

vec2 lightOverlayFaceUV(vec3 worldPos, vec3 normal) {
    vec3 a = abs(normal);

    // Orientation rules:
    // 1) Vertical faces: text always points up (uv.y follows +Y).
    // 2) Horizontal faces: text always points north (uv.y follows -Z).
    if (a.y >= a.x && a.y >= a.z) {
        return fract(vec2(worldPos.x, -worldPos.z));
    } else if (a.x >= a.z) {
        return fract(vec2(worldPos.z, worldPos.y));
    }
    return fract(vec2(worldPos.x, worldPos.y));
}

vec2 blockFaceUV(vec3 worldPos, vec3 normal) {
    vec3 a = abs(normal);
    if (a.y >= a.x && a.y >= a.z) {
        return fract(worldPos.xz);
    }
    if (a.x >= a.z) {
        return fract(vec2(worldPos.z, worldPos.y));
    }
    return fract(vec2(worldPos.x, worldPos.y));
}

vec2 blockFaceCoord(vec3 worldPos, vec3 normal) {
    vec3 a = abs(normal);
    if (a.y >= a.x && a.y >= a.z) {
        return worldPos.xz;
    }
    if (a.x >= a.z) {
        return vec2(worldPos.z, worldPos.y);
    }
    return vec2(worldPos.x, worldPos.y);
}

float quadOuterMaskFixedBlock(vec2 uv01, vec2 faceCoord) {
    const float borderBlock = 1.0 / 32.0;

    float gUvX = length(vec2(dFdx(uv01.x), dFdy(uv01.x)));
    float gUvY = length(vec2(dFdx(uv01.y), dFdy(uv01.y)));
    float gCx = length(vec2(dFdx(faceCoord.x), dFdy(faceCoord.x)));
    float gCy = length(vec2(dFdx(faceCoord.y), dFdy(faceCoord.y)));

    float blocksPerUvX = gCx / max(gUvX, 1e-6);
    float blocksPerUvY = gCy / max(gUvY, 1e-6);

    float uvBorderX = borderBlock / max(blocksPerUvX, 1e-6);
    float uvBorderY = borderBlock / max(blocksPerUvY, 1e-6);

    float mx = 1.0 - step(uvBorderX, min(uv01.x, 1.0 - uv01.x));
    float my = 1.0 - step(uvBorderY, min(uv01.y, 1.0 - uv01.y));
    return max(mx, my);
}

float minTileGridMask(vec2 faceCoord) {
    const float gridWidth = 1.0 / 48.0;
    vec2 cell = fract(faceCoord);
    float dx = min(cell.x, 1.0 - cell.x);
    float dy = min(cell.y, 1.0 - cell.y);
    return max(1.0 - step(gridWidth, dx), 1.0 - step(gridWidth, dy));
}

/**
 * 视差遮蔽映射 (Parallax Occlusion Mapping)
 * 参考：主流 LabPBR / Complementary 风格实现
 * - normal.a 视为 height01 (白=高)
 * - depth01 = 1 - height01
 * - 增加距离淡出与 dither 起步以降低条纹/闪烁
 *
 * @param texCoords 初始纹理坐标
 * @param viewDir 切线空间视线方向 (约定：+Z 为“朝外/朝观察者”)
 * @param textureIndex 纹理索引
 * @param viewDepthMeters 线性视空间深度 (meters)
 * @param dither01 噪声 [0,1) 用于随机化起步
 * @return 偏移后的纹理坐标
 */
vec2 ParallaxMapping(vec2 texCoords, vec3 viewDir, float textureIndex, float viewDepthMeters, float dither01) {
    if (!uHasNormalMap) return texCoords;
    if (uParallaxDepth <= 0.0) return texCoords;
    if (viewDir.z <= 1e-4) return texCoords; // 避免背面/极端角度导致除零与拉伸

    // 距离淡出：远处逐渐关闭 POM 以降低 shimmer
    const float PARALLAX_FADE_START = 24.0;
    const float PARALLAX_FADE_END   = 96.0;
    float parallaxFade = smoothstep(PARALLAX_FADE_START, PARALLAX_FADE_END, viewDepthMeters);

    // 角度淡出：极端掠射角容易出现拉伸与跳变，这里轻微衰减
    float angleFade = smoothstep(0.05, 0.25, abs(viewDir.z));

    float parallaxScale = uParallaxDepth * (1.0 - parallaxFade) * angleFade;
    if (parallaxScale <= 0.0) return texCoords;

    // 层数自适应：视线越平，层数越多
    const float minLayers = 8.0;
    const float maxLayers = 32.0;
    float numLayers = mix(maxLayers, minLayers, abs(dot(vec3(0.0, 0.0, 1.0), viewDir)));

    // 单层深度步进
    float layerDepth = 1.0 / numLayers;
    float currentLayerDepth;

    // 纹理坐标偏移步进 P = V.xy / V.z * scale
    vec2 P = (viewDir.xy / viewDir.z) * parallaxScale;
    vec2 deltaTexCoords = P / numLayers;

    // 初始状态
    float d = clamp(dither01, 0.0, 0.999);
    currentLayerDepth = d * layerDepth;
    vec2  currentTexCoords     = texCoords - deltaTexCoords * d;
    float currentDepthMapValue = 1.0 - texture(uNormalArray, vec3(currentTexCoords, textureIndex)).a;

    // 射线步进循环 (Raymarching Loop)
    for(int i = 0; i < 32; i++) {
        if(currentLayerDepth >= currentDepthMapValue) {
            break;
        }
        currentTexCoords -= deltaTexCoords;
        currentDepthMapValue = 1.0 - texture(uNormalArray, vec3(currentTexCoords, textureIndex)).a;
        currentLayerDepth += layerDepth;
    }

    // 线性插值细化 (Linear Interpolation Refinement)
    vec2 prevTexCoords = currentTexCoords + deltaTexCoords;

    // 计算碰撞前后的深度差
    float afterDepth  = currentDepthMapValue - currentLayerDepth;
    float beforeDepth = 1.0 - texture(uNormalArray, vec3(prevTexCoords, textureIndex)).a - currentLayerDepth + layerDepth;

    // 插值权重
    float weight = afterDepth / (afterDepth - beforeDepth);
    vec2 finalTexCoords = prevTexCoords * weight + currentTexCoords * (1.0 - weight);

    return finalTexCoords;
}

/**
 * 视差软阴影乘数 (Parallax Soft Shadow Multiplier)
 * @param L 切线空间光照方向
 * @param initialTexCoords 初始纹理坐标
 * @param initialHeight 初始高度
 * @param textureIndex 纹理索引
 * @return 阴影因子
 */
float ParallaxSoftShadowMultiplier(vec3 L, vec2 initialTexCoords, float initialHeight, float textureIndex) {
    float shadowMultiplier = 1.0;
    float alignFactor = dot(vec3(0, 0, 1), L);
    if(alignFactor > 0.0) {
        // 沿光照方向反向步进
        const float minLayers = 8.0;
        const float maxLayers = 32.0;
        float numSamples = mix(maxLayers, minLayers, abs(alignFactor));


        float stepSize = 1.0 / numSamples;
        float currentLayerHeight = initialHeight + stepSize * 0.1; // 略微抬高起点避免自交

        // 计算纹理步进向量
        // L.z > 0 (指向光源)
        // 步进比例 = L.xy / L.z
        vec2 texStep = L.xy / L.z * uParallaxDepth * stepSize;

        vec2 currentTexCoords = initialTexCoords + texStep;

        // 阴影射线步进
        for(int i = 0; i < 32; i++) {
            if(currentLayerHeight >= 1.0) break; // 到达高度图顶部

            float heightFromTexture = texture(uNormalArray, vec3(currentTexCoords, textureIndex)).a;

            if(heightFromTexture > currentLayerHeight) {
                // 命中遮挡物！
                // 软阴影计算：根据超出高度衰减
                float excessHeight = heightFromTexture - currentLayerHeight;
                shadowMultiplier = max(0.0, 1.0 - excessHeight * 10.0); // 软化因子
                if (shadowMultiplier < 0.1) break;
            }

            currentLayerHeight += stepSize;
            currentTexCoords += texStep;
        }
    }
    return shadowMultiplier;
}

// --- 自发光策略 (Emission Strategies) ---

/**
 * 原版自发光计算 (Vanilla Emission)
 * @param texColor 纹理颜色
 * @param vEmission 顶点自发光强度
 * @return 自发光颜色
 */
float calculateVanillaEmission(vec3 texColor, float vEmission) {
    // 亮度计算 (Luminance)
    highp float luminance = dot(texColor, vec3(0.2126, 0.7152, 0.0722));

    // 自动发光曲线 (Auto Emission Curve)
    float lum3 = luminance * luminance * luminance;
    float lightLevel = vEmission;
    float light15 = lightLevel * sqrt(lightLevel);
    float baseEmission = lum3 * light15;

    return max(0.0, (baseEmission - 0.1) * 2.5) * step(0.001, vEmission);
}

// --- LabPBR 辅助函数 ---

float decodeLabPBRRoughness(vec4 specSample) {
  // R通道: 平滑度 -> 粗糙度
  float smoothness = clamp(specSample.r, 0.0, 1.0);
  return clamp(1.0 - smoothness, 0.04, 1.0);
}

float decodeLabPBRMetallic(vec4 specSample) {
  // G通道 < 230 (0.901) 是 F0/电介质，>= 230 是金属
  // 这里我们只返回 0.0 或 1.0 作为 Metallic 标记，具体的 F0 计算在 Lighting Pass 或需要额外通道传输
  // 修正：之前直接返回 specSample.g 导致非金属 (G < 230) 被渲染成半金属
  return step(0.901, specSample.g);
}

float calculateLabPBREmission(vec4 specSample, vec3 specCoords) {
  float emission = specSample.a;

  // LabPBR 自发光阈值
  float isEmissive = step(emission, 0.999);

  // LOD0 钳制以避免 Mipmap 漏光
  float emissionLod0 = textureLod(uSpecularArray, specCoords, 0.0).a;
  emission = min(emission, emissionLod0);

  return emission * isEmissive;
}

/**
 * 计算切线空间矩阵 (Cotangent Frame)
 * @param N 宏观法线
 * @param p 位置
 * @param uv 纹理坐标
 * @return TBN 矩阵
 */
mat3 cotangent_frame(vec3 N, vec3 p, vec2 uv) {
    // 像素三角边微分
    highp vec3 dp1 = dFdx( p );
    highp vec3 dp2 = dFdy( p );
    highp vec2 duv1 = dFdx( uv );
    highp vec2 duv2 = dFdy( uv );

    // 解线性方程组
    highp vec3 dp2perp = cross( dp2, N );
    highp vec3 dp1perp = cross( N, dp1 );
    highp vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    highp vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;

    // 构造尺度不变基
    float invmax = inversesqrt( max( dot(T,T), dot(B,B) ) );
    return mat3( T * invmax, B * invmax, N );
}


void main() {
    // 调试路径：强制输出纯红
    // gRT0 = vec4(1.0, 0.0, 0.0, 1.0);
    // gRT1 = vec4(0.0, 1.0, 0.0, 1.0);
    // gRT2 = vec4(0.0, 0.0, 1.0, 1.0);
    // return;

    vec3 N = vNormal * inversesqrt(dot(vNormal, vNormal));

    // 计算 TBN 矩阵
    mat3 TBN = cotangent_frame(N, vPosition, vUV);

    // 计算切线空间视线向量 (用于 POM)
    // vPosition is camera-relative, so the view direction is simply from fragment to origin.
    vec3 viewDir = normalize(-vPosition);
    vec3 tangentViewDir = normalize(transpose(TBN) * viewDir);

    // 计算纹理梯度以避免 POM 导致的 Mipmap 伪影
    vec2 dUVdx = dFdx(vUV);
    vec2 dUVdy = dFdy(vUV);

    // [MODIFIED] Random Rotation Logic replaced by Texture LUT Lookup
    // vTextureIndex is the Base ID. We look up the real variant ID.

    // baseID is vTextureIndex.
    float baseID = floor(vTextureIndex + 0.5);
    float finalRealID = baseID;
    int finalVariantIndex = 0;
    int finalVariantDisplayIndex = 0;
    int finalVariantRotIndex = 0;

    // UV modification for rotation
    vec2 finalUV = vUV;

    // IMPORTANT: Only random-texture blocks should consult the LUT.
    // In Rust, random blocks are tagged via translucent_material_id (10/11), packed into vMaterialId.
    bool useVariantLut = (vMaterialId == 10u || vMaterialId == 11u);
    if (useVariantLut) {
        // Hash World Position to get variant index (0-3)
        vec3 absWorldPos = vPosition + uViewPos.xyz;
        // Offset slightly to ensure stability at integer boundaries
        vec3 blockPos = floor(absWorldPos + 0.001);
        uint h = hash3i(ivec3(blockPos));
        int variantIndex = int(h & 3u); // 0..3
        finalVariantIndex = variantIndex;

        // Compact LUT format:
        // Row 0: header (entryCount, dataRowCount)
        // Rows 1..entryCount: sparse index entries (baseId -> dataRowIndex)
        // Rows after entries: data rows (variant columns)
        ivec2 lutSize = textureSize(uVariantLUT, 0);
        if (lutSize.x > 1 && lutSize.y > 1 && variantIndex >= 0 && variantIndex < lutSize.x) {
            int entryCount = decodeU16RG(texelFetch(uVariantLUT, ivec2(0, 0), 0));
            entryCount = clamp(entryCount, 0, max(0, lutSize.y - 1));

            int baseIdI = int(baseID);
            int foundDataRowIndex = -1;

            const int MAX_VARIANT_ENTRIES = 256;
            for (int i = 0; i < MAX_VARIANT_ENTRIES; i++) {
                if (i >= entryCount) break;
                int entryY = 1 + i;
                vec4 keyPx = texelFetch(uVariantLUT, ivec2(0, entryY), 0);
                int keyBaseId = decodeU16RG(keyPx);
                if (keyBaseId == baseIdI) {
                    vec4 valPx = texelFetch(uVariantLUT, ivec2(1, entryY), 0);
                    foundDataRowIndex = decodeU16RG(valPx);
                    break;
                }
            }

            if (foundDataRowIndex >= 0) {
                int rowY = 1 + entryCount + foundDataRowIndex;
                if (rowY >= 0 && rowY < lutSize.y) {
                    vec4 lutVal = texelFetch(uVariantLUT, ivec2(variantIndex, rowY), 0);

                    // Decode ID: (R * 255 * 256) + (G * 255)
                    // lutVal is normalized [0,1].
                    float highByte = floor(lutVal.r * 255.0 + 0.5);
                    float lowByte = floor(lutVal.g * 255.0 + 0.5);
                    float decoded = highByte * 256.0 + lowByte;

                    // If LUT returns 0 (pure black) for non-zero input, treat it as missing mapping?
                    if (decoded > 0.5 || baseID < 0.5) {
                        finalRealID = decoded;
                    }

                    // --- Rotation Logic (Blue Channel) ---
                    // B = 0,1,2,3 for 0, 90, 180, 270 deg
                    int rotInd = int(floor(lutVal.b * 255.0 + 0.5));
                    finalVariantRotIndex = ((rotInd % 4) + 4) % 4;

                    // For debug display, convert raw hash bucket (0..3) to effective variant ordinal.
                    int selIdHi = decodeByte01(lutVal.r);
                    int selIdLo = decodeByte01(lutVal.g);
                    int selRot = decodeByte01(lutVal.b);
                    int selMir = decodeByte01(lutVal.a);

                    int uniqCount = 0;
                    int uniqIdHi[4];
                    int uniqIdLo[4];
                    int uniqRot[4];
                    int uniqMir[4];
                    int selectedOrdinal = 0;

                    for (int c = 0; c < 4; c++) {
                        vec4 cv = texelFetch(uVariantLUT, ivec2(c, rowY), 0);
                        int cIdHi = decodeByte01(cv.r);
                        int cIdLo = decodeByte01(cv.g);
                        int cRot = decodeByte01(cv.b);
                        int cMir = decodeByte01(cv.a);

                        int found = -1;
                        for (int u = 0; u < 4; u++) {
                            if (u >= uniqCount) break;
                            bool same = (uniqIdHi[u] == cIdHi) && (uniqIdLo[u] == cIdLo) && (uniqRot[u] == cRot) && (uniqMir[u] == cMir);
                            if (same) {
                                found = u;
                                break;
                            }
                        }

                        int ord = found;
                        if (found < 0) {
                            ord = uniqCount;
                            uniqIdHi[ord] = cIdHi;
                            uniqIdLo[ord] = cIdLo;
                            uniqRot[ord] = cRot;
                            uniqMir[ord] = cMir;
                            uniqCount++;
                        }

                        if (c == variantIndex) {
                            selectedOrdinal = ord;
                        }
                    }

                    // Prefer exact selected tuple match for safety if any edge case above diverges.
                    for (int u = 0; u < 4; u++) {
                        if (u >= uniqCount) break;
                        bool sameSel = (uniqIdHi[u] == selIdHi) && (uniqIdLo[u] == selIdLo) && (uniqRot[u] == selRot) && (uniqMir[u] == selMir);
                        if (sameSel) {
                            selectedOrdinal = u;
                            break;
                        }
                    }
                    finalVariantDisplayIndex = selectedOrdinal;

                    // Apply rotation only if LUT dictates it (>0)
                    if (rotInd > 0) {
                        // Apply rotation to finalUV
                        // Decompose to cell + local
                        vec2 cellBase = floor(finalUV);
                        vec2 local = fract(finalUV);
                        local -= 0.5;

                        // CW Rotation
                        if (rotInd == 1) { // 90
                            local = vec2(local.y, -local.x);
                        } else if (rotInd == 2) { // 180
                            local = vec2(-local.x, -local.y);
                        } else if (rotInd == 3) { // 270
                            local = vec2(-local.y, local.x);
                        }
                        local += 0.5;
                        finalUV = cellBase + local;
                    }
                }
            }
        }
    }

    float textureIndex = finalRealID;

    // --- DEBUG: Visualize Texture ID Issues ---
    // Uncomment to debug "All Leaves" issue
    // if (baseID > 0.5 && finalRealID < 0.5) {
    //     // Input was valid, output is 0 -> LUT Lookup Failed (Blue)
    //     gRT0 = vec4(0.0, 0.0, 1.0, 1.0);
    //     return;
    // }
    // if (baseID < 0.5) {
    //     // Input was 0 -> Vertex Attribute Failed (Red)
    //     // Note: Leaves/Air might legitimately be 0.
    //     // gRT0 = vec4(1.0, 0.0, 0.0, 1.0);
    //     // return;
    // }
    // ------------------------------------------

    // 应用视差映射 (Parallax Mapping)
    float pomDither = InterleavedGradientNoise(floor(gl_FragCoord.xy));
    // Use the RESOLVED textureIndex and ROTATED UV for POM and sampling!
    vec2 texCoords = ParallaxMapping(finalUV, tangentViewDir, textureIndex, vViewDepth, pomDither);

    vec3 specCoords = vec3(texCoords, textureIndex);
    vec4 specSample = vec4(0.0);


    // 无分支法线贴图采样
    // 使用 textureGrad 确保正确的 Mipmap 层级选择
    vec3 normalSample = textureGrad(uNormalArray, specCoords, dUVdx, dUVdy).rgb;
    vec3 map = normalSample * 2.0 - 1.0;

    // LabPBR 法线贴图 Z 轴重建 - 移除强制 Z 重建，使用原始 RGB 数据以匹配 Old 引擎效果
    // if (uHasNormalMap) {
    //     if (map.x + map.y > -1.999) {
    //         // 重建 Z 轴
    //         if (length(map.xy) > 1.0) map.xy = normalize(map.xy);
    //         map.z = sqrt(1.0 - dot(map.xy, map.xy));
    //         map = normalize(map);
    //     } else {
    //         // 回退或标记
    //         map = vec3(0.0, 0.0, 1.0);
    //     }
    // }

    map.xy *= uNormalScale; // 使用 Uniform 控制强度
    map = normalize(map);   // 缩放后重新归一化

    vec3 worldNormal = TBN * map;
    vec3 N_mapped = worldNormal * inversesqrt(dot(worldNormal, worldNormal));
    N = mix(N, N_mapped, float(uHasNormalMap));

    // --- PBR Texture Reading ---
    if (uHasSpecularMap) {
        // use resolved textureIndex
        vec3 specCoordsAdjusted = vec3(texCoords, textureIndex);
        specSample = textureGrad(uSpecularArray, specCoordsAdjusted, dUVdx, dUVdy);
    }

    // 采样纹理
    // Modified to use RESOLVED textureIndex
    vec3 specCoordsAdjusted = vec3(texCoords, textureIndex);
    vec4 texColor = textureGrad(uTextureArray, specCoordsAdjusted, dUVdx, dUVdy);
    texColor = mix(vec4(1.0), texColor, float(uHasTexture));
    texColor.rgb = texColor.rgb * texColor.rgb;

    TranslucentMaterialParams materialParams = getTranslucentMaterialParams(vMaterialId);

#if GEOMETRY_ALPHA_TEST
    // 透明度测试（Cutout only）
    if (texColor.a < uAlphaCutoff) {
        discard;
    }
#endif

    // 计算反照率 (Albedo)
    vec3 albedo = uBaseColor * texColor.rgb * vColor;
    albedo *= materialParams.colorScale;

    // 自阴影 (伪 AO)（默认关闭）
    // 这段会直接压暗 albedo，容易在 UV/alpha-test 边界与块边缘形成“边缝 AO”。
    // 仅用于调试/对比；生产建议把遮蔽输出到单独通道并在光照阶段合成。
    if (uEnableParallaxSelfShadow > 0.5 && uParallaxDepth > 0.0) {
        float height = textureGrad(uNormalArray, vec3(texCoords, textureIndex), dUVdx, dUVdy).a;
        float parallaxAO = mix(1.0, height, uParallaxDepth * 2.0); // 基于深度的简单 AO
        parallaxAO = clamp(parallaxAO, 0.5, 1.0);
        albedo *= parallaxAO;
    }

    specSample = textureGrad(uSpecularArray, specCoords, dUVdx, dUVdy);
    specSample = mix(vec4(0.0, 0.0, 0.0, 1.0), specSample, float(uHasSpecularMap));

    // 写入 G-Buffer
    float roughness = mix(uRoughness, decodeLabPBRRoughness(specSample), float(uHasSpecularMap));
    roughness = clamp(roughness * materialParams.roughnessScale, 0.02, 1.0);
    float metallic = mix(uMetallic, max(uMetallic, decodeLabPBRMetallic(specSample)), float(uHasSpecularMap));

    // 计算自发光 (Emission)
    float emission = 0.0;

    // 选择自发光策略
    float vanillaEmission = calculateVanillaEmission(texColor.rgb, vEmission);
    float labEmission = calculateLabPBREmission(specSample, specCoords);

    // 混合步骤避免分支
    float useLab = step(0.01, labEmission) * float(uHasSpecularMap);
    emission = mix(vanillaEmission, labEmission, useLab);

#if GEOMETRY_ALPHA_TEST
    // Debug: Force Cutout (decal buffer) to render purple/black checkerboard.
    if (uDebugCutout > 0.5) {
        vec3 worldPos = vPosition + uViewPos.xyz;
        vec2 faceCoord = blockFaceCoord(worldPos, normalize(vNormal));
        float checker = mod(floor(faceCoord.x * 4.0) + floor(faceCoord.y * 4.0), 2.0);
        vec3 debugColor = mix(vec3(0.0, 0.0, 0.0), vec3(1.0, 0.0, 1.0), checker);
        albedo = debugColor;
        emission = max(emission, 0.15);
    }
#endif

    // 打包策略 (Packing Strategy)
    // Target 0: Albedo RGB + Emission A -> RT0
    // DEBUG: Visualize Quad Borders
    if (uShowDebugBorders > 0.5) {
        vec3 worldPos = vPosition + uViewPos.xyz;
        vec2 faceCoord = blockFaceCoord(worldPos, normalize(vNormal));

        // All quads: outer border red/green, fixed to 1/32 block units.
        float outer = quadOuterMaskFixedBlock(vDebugUV, faceCoord);
        vec3 quadColor = (vMaterialId == 10u || vMaterialId == 11u)
            ? vec3(0.0, 1.0, 0.0)
            : vec3(1.0, 0.0, 0.0);
        albedo = mix(albedo, quadColor, outer);
        emission = max(emission, outer);

        // Inside each quad: split minimal face tiles in purple, 1/48 block units.
        float innerGrid = minTileGridMask(faceCoord) * (1.0 - outer);
        albedo = mix(albedo, vec3(0.70, 0.25, 1.0), innerGrid);
        emission = max(emission, innerGrid);
    }

    if (uShowLightNumbers > 0.5) {
        vec3 worldPos = vPosition + uViewPos.xyz;
        vec2 uvFace = lightOverlayFaceUV(worldPos, normalize(vNormal));

        int skyVal = int(floor(clamp(vSkyLight, 0.0, 1.0) * 15.0 + 0.5));
        int blockVal = int(floor(clamp(vBlockLight, 0.0, 1.0) * 15.0 + 0.5));

        vec2 skyUV = (uvFace - vec2(0.04, 0.56)) / vec2(0.40, 0.40);
        vec2 blockUV = (uvFace - vec2(0.56, 0.04)) / vec2(0.40, 0.40);

        float skyMask = decimalValueMask(skyUV, skyVal);
        float blockMask = decimalValueMask(blockUV, blockVal);

        // Arrow hints for readability in V debug.
        vec2 skyArrowUV = (uvFace - vec2(0.46, 0.58)) / vec2(0.14, 0.30);
        vec2 blockArrowUV = (uvFace - vec2(0.44, 0.08)) / vec2(0.14, 0.30);
        float skyArrow = arrowMask(skyArrowUV, 0);
        float blockArrow = arrowMask(blockArrowUV, 2);

        albedo = mix(albedo, vec3(0.30, 0.90, 1.00), skyMask);
        albedo = mix(albedo, vec3(1.00, 0.76, 0.25), blockMask);
        albedo = mix(albedo, vec3(0.20, 0.95, 1.00), skyArrow);
        albedo = mix(albedo, vec3(1.00, 0.72, 0.20), blockArrow);
        // Ensure light numbers are not darkened by shadow/vertex lighting in lighting pass.
        emission = max(emission, max(max(skyMask, blockMask), max(skyArrow, blockArrow)));
    }

    if (uShowVariantIndices > 0.5) {
        vec3 worldPos = vPosition + uViewPos.xyz;
        vec2 uvFace = lightOverlayFaceUV(worldPos, normalize(vNormal));

        // Lower-left block (kept away from existing light-number overlays).
        vec2 variantUV = (uvFace - vec2(0.06, 0.06)) / vec2(0.34, 0.34);
        float variantMask = decimalValueMask(variantUV, finalVariantDisplayIndex);

        // Arrow hint in N debug: points to current variant rotation direction.
        vec2 variantArrowUV = (uvFace - vec2(0.42, 0.08)) / vec2(0.14, 0.30);
        float variantArrowMask = arrowMask(variantArrowUV, finalVariantRotIndex);

        // Cyan tint for variant index debug.
        albedo = mix(albedo, vec3(0.20, 1.00, 0.95), variantMask);
        albedo = mix(albedo, vec3(0.15, 0.95, 0.85), variantArrowMask);
        emission = max(emission, max(variantMask, variantArrowMask));
    }

    gRT0 = vec4(albedo, emission);

    // Target 1: Normal RGB -> RT1
    // 存储全精度法线 [-1, 1] -> [0, 1]
    gRT1 = vec4(N * 0.5 + 0.5, 1.0);

    // Target 2: PBR + Light -> RT2
    // R: Roughness, G: Metallic, B: SkyLight, A: BlockLight
    gRT2 = vec4(roughness, metallic, vSkyLight, vBlockLight);

    // Target 3: Linear depth (encoded)
    // Store linear01 = viewDepth / far, packed into RG8.
    // When uWriteLinearDepth is false, output is ignored (drawBuffers won't include attachment3).
    if (uWriteLinearDepth) {
        float linear01 = vViewDepth / max(uCameraFar, 0.0001);
        vec2 rg = packUnorm16(linear01);
        gRT3 = vec4(rg, 0.0, 1.0);
    } else {
        gRT3 = vec4(0.0);
    }

    // DEBUG: Force Albedo to Red to verify GeometryPass output
    // gRT0 = vec4(1.0, 0.0, 0.0, 1.0);
}
