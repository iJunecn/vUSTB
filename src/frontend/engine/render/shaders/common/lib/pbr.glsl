
/**
 * @file pbr.glsl
 * @brief PBR 光照与材质工具函数
 *
 * 包含 GGX 分布、Smith 几何项、Schlick Fresnel、ACES 色调映射,
 * 以及法线编码/解码与 LabPBR 材质辅助工具。
 */

const float PI = 3.14159265359;
const float INV_PI = 0.31830988618;

/**
 * 八面体法线解码 (Octahedral Normal Decode)
 * @param e 编码后的二维向量
 * @return 归一化法线
 */
vec3 decodeOctahedralNormal(vec2 e) {
    e = e * 2.0 - 1.0;
    vec3 v = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
    float t = step(v.z, 0.0);
    v.xy = mix(v.xy, (1.0 - abs(v.yx)) * sign(v.xy), t);
    // 直接用 inversesqrt 做归一化, 避免多余的 sqrt。
    return v * inversesqrt(dot(v, v));
}

/**
 * 八面体法线编码 (Octahedral Normal Encode)
 * @param n 归一化法线
 * @return 编码后的二维向量
 */
vec2 encodeOctahedralNormal(vec3 n) {
    n *= 1.0 / (abs(n.x) + abs(n.y) + abs(n.z));
    float t = step(n.z, 0.0);
    n.xy = mix(n.xy, (1.0 - abs(n.yx)) * sign(n.xy), t);
    return n.xy * 0.5 + 0.5;
}

/**
 * 位置重建 (Position Reconstruction)
 * @param depth 深度值 [0, 1]
 * @param uv 屏幕 UV [0, 1]
 * @param inverseViewProj 逆视图投影矩阵
 * @return 重建后的世界空间位置
 */
vec3 reconstructPosition(float depth, vec2 uv, mat4 inverseViewProj) {
    float z = depth * 2.0 - 1.0; // NDC Z
    vec4 clipSpacePosition = vec4(uv * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = inverseViewProj * clipSpacePosition;
    return viewSpacePosition.xyz * (1.0 / viewSpacePosition.w); // 透视除法
}

/**
 * GGX 法线分布函数 (Normal Distribution Function)
 * @param N 表面法线
 * @param H 半角向量
 * @param roughness 粗糙度
 * @return 分布项 D
 *
 * 公式:
 * `D = a^2 / (PI * ((N·H)^2 * (a^2 - 1) + 1)^2)`
 */
float DistributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a; // a^2
    highp float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;

    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = (denom * denom) * PI;

    // 防止分母过小导致高光尖峰失控。
    return a2 / max(denom, 0.001);
}

/**
 * Schlick-GGX 几何项近似 (Geometry Shadowing)
 * @param NdotV 法线与视线夹角余弦
 * @param roughness 粗糙度
 * @return 几何遮蔽项
 */
float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) * 0.125; // k = (r+1)2/8

    // 保留乘加结构, 便于驱动做 MAD / FMA 优化。
    return NdotV / (NdotV * (1.0 - k) + k);
}

/**
 * Smith 几何遮蔽函数 (Geometry Smith)
 * @param N 法线
 * @param V 视线方向
 * @param L 光照方向
 * @param roughness 粗糙度
 * @return 联合几何项 G
 */
float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    highp float NdotV = max(dot(N, V), 0.0);
    highp float NdotL = max(dot(N, L), 0.0);
    return GeometrySchlickGGX(NdotV, roughness) * GeometrySchlickGGX(NdotL, roughness);
}

/**
 * Schlick Fresnel 近似
 * @param cosTheta 观察方向与半角向量夹角余弦
 * @param F0 法线入射反射率
 * @return Fresnel 项 F
 *
 * 公式:
 * `F = F0 + (1 - F0) * (1 - cosTheta)^5`
 */
vec3 FresnelSchlick(float cosTheta, vec3 F0) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x2 = x * x;
    float x5 = x2 * x2 * x; // (1 - cosTheta)^5
    return mix(F0, vec3(1.0), x5);
}

/**
 * ACES 色调映射 (Tone Mapping)
 * @param x HDR 颜色
 * @return LDR 颜色
 */
vec3 ACESFilm(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    // 钳制到显示空间范围。
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * LabPBR 金属度与 F0 解码
 * @param metallicRaw 原始 metallic 通道值 [0, 1]
 * @param albedo 基础颜色
 * @param metallic 输出金属度
 * @param F0 输出反射率 F0
 */
void decodeLabPBRMetallicAndF0(float metallicRaw, vec3 albedo, out float metallic, out vec3 F0) {
    float isMetallic = step(0.901, metallicRaw);
    metallic = isMetallic;

    float g = metallicRaw * 255.0;

    // 按 metallicMap 的离散编码查表 F0。
    F0 = vec3(0.04); // 绝缘体默认值
    F0 = mix(F0, vec3(0.56, 0.57, 0.58), step(229.5, g) * step(g, 230.5)); // Iron 铁
    F0 = mix(F0, vec3(1.00, 0.71, 0.29), step(230.5, g) * step(g, 231.5)); // Gold 金
    F0 = mix(F0, vec3(0.91, 0.92, 0.92), step(231.5, g) * step(g, 232.5)); // Aluminum 铝
    F0 = mix(F0, vec3(0.55, 0.56, 0.55), step(232.5, g) * step(g, 233.5)); // Chrome 铬
    F0 = mix(F0, vec3(0.95, 0.64, 0.54), step(233.5, g) * step(g, 234.5)); // Copper 铜
    F0 = mix(F0, vec3(0.63, 0.63, 0.63), step(234.5, g) * step(g, 235.5)); // Lead 铅
    F0 = mix(F0, vec3(0.67, 0.66, 0.63), step(235.5, g) * step(g, 236.5)); // Platinum 铂
    F0 = mix(F0, vec3(0.95, 0.93, 0.88), step(236.5, g) * step(g, 237.5)); // Silver 银
    F0 = mix(F0, vec3(0.78, 0.78, 0.78), step(237.5, g) * step(g, 238.5)); // Mercury 汞
    F0 = mix(F0, albedo, step(238.5, g)); // 自定义金属色

    F0 = mix(vec3(0.04), F0, isMetallic);
}

/**
 * 屏幕空间交错梯度噪声 (Interleaved Gradient Noise)
 * @param position_screen 屏幕坐标
 * @return 噪声值 [0, 1]
 */
float InterleavedGradientNoise(vec2 position_screen) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(position_screen, magic.xy)));
}

// 原版风格的半透明自发光近似。
vec3 calculateVanillaTranslucentEmission(vec3 baseColor, float emissionLevel) {
    highp float luminance = dot(baseColor, vec3(0.2126, 0.7152, 0.0722));
    float lum3 = (luminance * luminance) * luminance;
    return baseColor * (lum3 * emissionLevel * 5.0);
}

// 单光源 PBR 直接光照。
vec3 PBRDirect(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 albedo, float roughness, vec3 F0) {
    // 用显式 inversesqrt 归一化半角向量，避免额外 sqrt。
    vec3 H_unnorm = V + L;
    vec3 H = H_unnorm * inversesqrt(dot(H_unnorm, H_unnorm));

    float NDF = DistributionGGX(N, H, roughness);
    float G   = GeometrySmith(N, V, L, roughness);
    vec3 F    = FresnelSchlick(max(dot(H, V), 0.0), F0);

    highp float NdotV = max(dot(N, V), 0.0);
    highp float NdotL = max(dot(N, L), 0.0);

    vec3 specular = (NDF * G * F) / (4.0 * NdotV * NdotL + 0.0001);
    vec3 kD = (vec3(1.0) - F) * (1.0 - step(0.5, F0.r + F0.g + F0.b));

    return (kD * albedo * INV_PI + specular) * radiance * NdotL;
}
