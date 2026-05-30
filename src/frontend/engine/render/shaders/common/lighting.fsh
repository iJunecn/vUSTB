#version 300 es
precision highp float;
precision highp sampler2DArray;

/**
 * @file lighting.fsh
 * @brief 延迟渲染光照阶段片元着色器 (Deferred Lighting Fragment Shader)
 *
 * 负责读取 G-Buffer，计算环境光、直接光 (太阳光、点光源)、阴影、PBR 光照以及后处理 (雾、色调映射)。
 */

// --- Inputs 输入变量 ---
in vec2 vUV; // 屏幕空间纹理坐标

// --- Outputs 输出变量 ---
layout(location = 0) out vec4 fragColor; // 最终屏幕颜色

// --- Uniforms: G-Buffer ---
uniform sampler2D uRT0;    // RT0: Albedo (RGB) + Emission (A)
uniform sampler2D uRT1;    // RT1: Normal (RGB)
uniform sampler2D uRT2;    // RT2: Roughness (R) + Metallic (G) + SkyLight (B) + BlockLight (A)
uniform sampler2D uGDepth; // 深度纹理

// Optional linear depth (RG8 packed 16-bit UNORM: linear01=viewDepth/far)
uniform sampler2D uLinearDepth;

// Depth sampling helpers
uniform sampler2D uSSAO;       // SSAO 遮蔽因子纹理
uniform bool uUseSSAO;         // SSAO 开关

// --- Uniforms: Camera 相机参数 ---
layout(std140) uniform CameraUniforms {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    mat4 uInverseViewProj;
    vec4 uViewPos;
};

// uniform mat4 uInverseViewProj;  // Removed

// --- Uniforms: Lights 光源参数 ---
uniform sampler2D uLightBuffer; // 点光源数据纹理
uniform int uLightCount;        // 点光源数量

uniform bool uUseClusteredLights;
uniform ivec3 uClusterDims;
uniform int uClusterMaxLights;
uniform vec4 uClusterZParams; // near, far, logFactor, zSlices
uniform vec2 uClusterIndexTexSize;
uniform sampler2D uClusterCounts;
uniform sampler2D uClusterIndices;

uniform bool uUsePointShadows;
uniform highp sampler2DArray uPointShadowMap;
uniform int uPointShadowCount;
uniform int uPointShadowLightIndices[8];

layout(std140) uniform SceneUniforms {
    vec4 uSunDirection;       // w unused
    vec4 uSunColor;           // w unused
    vec4 uAmbientSkyColor;    // w unused
    vec4 uAmbientGroundColor; // w unused
    float uAmbientIntensity;
    float uIBLIntensity;
    float uTime;
    float _scenePadding0;     // std140 对齐填充
    mat4 uLightSpaceMatrices[4];
    vec4 uCascadeSplits;
};

// uniform float uIBLIntensity;      // Removed

// --- Uniforms: Shadows 阴影参数 ---
// 移动端修复: 必须使用highp避免精度丢失导致阴影位置错误
uniform highp sampler2DArray uShadowMap;      // 级联阴影贴图 (深度)
uniform highp sampler2DArray uShadowColorMap; // 彩色阴影贴图 (透射率)

#include "lib/frame_uniforms.glsl"

#include "lib/pbr.glsl"
#include "lib/shadow.glsl"
#include "lib/sky.glsl"

const int MAX_CLUSTER_LIGHTS = 64;
const int MAX_POINT_SHADOWS = 8;

// Vanilla-like light darkness mapping.
// Approximates Minecraft's non-linear light response: dark levels lift a bit,
// mid/high levels remain contrasty without the overly dark pow(2.2) look.
float vanillaLightIntensity(float light01) {
    light01 = clamp(light01, 0.0, 1.0);
    float curve = light01 / (4.0 - 3.0 * light01);
    // Keep tiny floor in lit workflow so level-1..2 is still readable.
    return max(curve, 0.0);
}

float sampleGBufferDepth(vec2 uv) {
    float d0 = texture(uGDepth, uv).r;
    if (frameDepthFilterMode() == 0) return d0;

    // 4-tap average around pixel center to smooth quantization bands.
    // Clamp to avoid sampling outside.
    vec2 t = frameInvScreenSize();
    vec2 o = 0.5 * t;
    float d1 = texture(uGDepth, clamp(uv + vec2(-o.x, -o.y), 0.0, 1.0)).r;
    float d2 = texture(uGDepth, clamp(uv + vec2( o.x, -o.y), 0.0, 1.0)).r;
    float d3 = texture(uGDepth, clamp(uv + vec2(-o.x,  o.y), 0.0, 1.0)).r;
    float d4 = texture(uGDepth, clamp(uv + vec2( o.x,  o.y), 0.0, 1.0)).r;
    return (d1 + d2 + d3 + d4) * 0.25;
}

float unpackUnorm16(vec2 rg) {
    float hi = rg.x * 255.0;
    float lo = rg.y * 255.0;
    float u = hi * 256.0 + lo;
    return u / 65535.0;
}

float depth01FromViewDepth(float viewDepth) {
    float n = frameCameraNear();
    float f = frameCameraFar();
    float denom = max(f - n, 0.0001);
    float zNdc = (f + n) / denom - (2.0 * f * n) / (denom * max(viewDepth, 0.0001));
    float depth01 = zNdc * 0.5 + 0.5;
    return frameUseReverseZ() ? (1.0 - depth01) : depth01;
}

float sampleDepth01(vec2 uv) {
    if (!frameUseLinearDepth()) {
        return sampleGBufferDepth(uv);
    }

    vec2 rg = texture(uLinearDepth, uv).rg;
    float linear01 = unpackUnorm16(rg);
    // Sky pixels are cleared to 1.0
    if (linear01 >= 0.999999) return frameUseReverseZ() ? 0.0 : 1.0;
    float viewDepth = linear01 * max(frameCameraFar(), 0.0001);
    return clamp(depth01FromViewDepth(viewDepth), 0.0, 1.0);
}

float viewDepthFromDepth01(float depth01) {
    float d = frameUseReverseZ() ? (1.0 - depth01) : depth01;
    float zNdc = d * 2.0 - 1.0;
    float n = frameCameraNear();
    float f = frameCameraFar();
    float denom = max(f + n - zNdc * (f - n), 0.0001);
    return (2.0 * n * f) / denom;
}

vec3 reconstructSkyViewDirection(vec2 uv, mat4 projectionMatrix) {
    vec2 ndc = uv * 2.0 - 1.0;
    float projX = max(abs(projectionMatrix[0][0]), 0.0001);
    float projY = max(abs(projectionMatrix[1][1]), 0.0001);
    return normalize(vec3(ndc.x / projX, ndc.y / projY, -1.0));
}

vec3 reconstructSkyWorldDirection(vec2 uv, mat4 viewMatrix, mat4 projectionMatrix) {
    vec3 viewDir = reconstructSkyViewDirection(uv, projectionMatrix);
    return normalize(transpose(mat3(viewMatrix)) * viewDir);
}

int getClusterIndex(float viewDepth, vec2 uv) {
    float nearZ = uClusterZParams.x;
    float farZ = uClusterZParams.y;
    float logFactor = uClusterZParams.z;
    float zSlices = uClusterZParams.w;

    int x = int(clamp(floor(uv.x * float(uClusterDims.x)), 0.0, float(uClusterDims.x - 1)));
    int y = int(clamp(floor(uv.y * float(uClusterDims.y)), 0.0, float(uClusterDims.y - 1)));

    float z = clamp(viewDepth, nearZ, farZ);
    float zNorm = log(z / nearZ) * logFactor;
    int zi = int(clamp(floor(zNorm * zSlices), 0.0, zSlices - 1.0));

    return x + y * uClusterDims.x + zi * uClusterDims.x * uClusterDims.y;
}

int fetchClusterCount(int clusterIndex) {
    float c = texelFetch(uClusterCounts, ivec2(clusterIndex, 0), 0).r;
    return int(c + 0.5);
}

int fetchClusterLightIndex(int index) {
    int texelIndex = index / 4;
    int comp = index - texelIndex * 4;
    int x = texelIndex % int(uClusterIndexTexSize.x);
    int y = texelIndex / int(uClusterIndexTexSize.x);
    vec4 v = texelFetch(uClusterIndices, ivec2(x, y), 0);
    float f = (comp == 0) ? v.r : (comp == 1) ? v.g : (comp == 2) ? v.b : v.a;
    return int(f + 0.5);
}

int getPointShadowIndex(int lightIndex) {
    if (!uUsePointShadows || uPointShadowCount <= 0) return -1;
    for (int i = 0; i < MAX_POINT_SHADOWS; i++) {
        if (i >= uPointShadowCount) break;
        if (uPointShadowLightIndices[i] == lightIndex) return i;
    }
    return -1;
}

vec2 cubeUV(vec3 dir, out int face) {
    vec3 a = abs(dir);
    if (a.x >= a.y && a.x >= a.z) {
        if (dir.x > 0.0) {
            face = 0;
            return vec2(-dir.z, dir.y) / a.x;
        }
        face = 1;
        return vec2(dir.z, dir.y) / a.x;
    } else if (a.y >= a.z) {
        if (dir.y > 0.0) {
            face = 2;
            return vec2(dir.x, -dir.z) / a.y;
        }
        face = 3;
        return vec2(dir.x, dir.z) / a.y;
    }
    if (dir.z > 0.0) {
        face = 4;
        return vec2(dir.x, dir.y) / a.z;
    }
    face = 5;
    return vec2(-dir.x, dir.y) / a.z;
}

float samplePointShadow(int shadowIndex, vec3 lightPos, float radius, vec3 worldPos) {
    vec3 dir = worldPos - lightPos;
    float dist = length(dir);
    if (dist >= radius) return 1.0;

    int face = 0;
    vec2 uv = cubeUV(dir, face);
    uv = uv * 0.5 + 0.5;

    float depth = dist / radius;
    int layer = shadowIndex * 6 + face;
    float shadowDepth = texture(uPointShadowMap, vec3(uv, float(layer))).r;
    return (depth - framePointShadowBias()) > shadowDepth ? 0.0 : 1.0;
}

void main() {
    // 读取 G-Buffer (Read G-Buffer)
    vec4 rt0 = texture(uRT0, vUV);
    vec4 rt1 = texture(uRT1, vUV);
    vec4 rt2 = texture(uRT2, vUV);
    float depth = texture(uGDepth, vUV).r;

    // 天空背景 (Procedural Sky + Clouds)
    if (frameUseReverseZ() ? (depth <= 0.000001) : (depth >= 0.999999)) {
        // 不再通过“天空点 - 相机位置”重建方向，避免大世界坐标在移动端/Intel 上发生精度抵消。
        vec3 V = reconstructSkyWorldDirection(vUV, uView, uProjection);
        vec3 L = normalize(-uSunDirection.xyz);

        // 1. 大气背景 (含高度感知)
        vec3 skyColor = getSimpleAtmosphere(V, L, uViewPos.y);

        // 2. 云层叠加 (射线-平面求交, 世界锚定)
        vec4 cloudData = getClouds(V, L, uTime * 0.05, frameCloudCover(), uViewPos.xyz);
        skyColor = mix(skyColor, cloudData.rgb, cloudData.a);

        fragColor = vec4(skyColor, 1.0);
        return;
    }

    // 解包数据 (Unpack Data)
    // Render Target 0: Albedo RGB + Emission A
    vec3 albedo = rt0.rgb;
    float emission = rt0.a;

    // Render Target 1: Normal RGB
    vec3 N = normalize(rt1.rgb * 2.0 - 1.0);

    // Render Target 2: PBR + Light
    float roughness = rt2.r;
    float metallic = rt2.g;

     // [DEBUG FIX] 检测异常材质组合：完全金属 + 粗糙 -> 强制重置为非金属
    // 修复绿宝石块/蜂巢块因LabPBR数据错误(被标记为金属)导致的黑屏问题
    // if (metallic > 0.8 && roughness > 0.4) {
    //    metallic = 0.0;
    // }

    float skyLight = rt2.b;
    float blockLight = rt2.a;

    vec3 F0 = mix(vec3(0.04), albedo, metallic); // 简单 F0 推导

    // 简单的天空遮罩曲线
    float skyMask = skyLight;

    float ao = 1.0;
    // 重建世界坐标 (Reconstruct World Position)
    vec3 worldPos = reconstructPosition(depth, vUV, uInverseViewProj);
    vec3 V = normalize(uViewPos.xyz - worldPos);

    // 使用线性 Z 进行级联选择 (匹配 CPU 分割逻辑)
    vec4 viewPos = uView * vec4(worldPos, 1.0);
    float viewDepth = -viewPos.z;

    // 模式 0: 性能模式 (顶点光照)
    if (!frameUsePBR()) {
        // 简单的顶点光照通道
        float skyIntensity = frameUseVertexLighting() ? vanillaLightIntensity(skyLight) : 0.5;
        float blockIntensity = frameUseVertexLighting() ? vanillaLightIntensity(blockLight) : 0.0;

        // 基础方向光着色
        float NdotL = 0.5 + 0.5 * N.y;

        vec3 skyAmbient = uAmbientSkyColor.rgb * skyIntensity * NdotL;
        vec3 blockAmbient = vec3(1.0, 0.9, 0.7) * blockIntensity;

        vec3 finalColor = albedo * (skyAmbient + blockAmbient + vec3(0.03)); // 基础环境光

        // 雾效计算 (Fog Calculation)
        float dist = length(uViewPos.xyz - worldPos);
        float fogFactor = clamp((dist - frameFogStart()) / (frameFogEnd() - frameFogStart()), 0.0, 1.0);
        fragColor = vec4(mix(finalColor, frameFogColor(), fogFactor), 1.0);
        return;
    }

    // --- 环境光照 (Environment Lighting) ---

    // 天空环境光 (Sky Ambient)
    // 降低一半的天空环境光基础亮度，避免正午全屏泛白
    float ambientMix = clamp(0.5 + 0.5 * N.y, 0.0, 1.0);
    vec3 baseAmbient = mix(uAmbientGroundColor.rgb, uAmbientSkyColor.rgb, ambientMix) * 0.6;

    // 基础环境光强度
    float skyIntensity = 0.0;
    if (frameUseVertexLighting()) {
        // Vanilla-like non-linear light curve
        skyIntensity = vanillaLightIntensity(skyLight);
    } else {
        // 简单常量回退
        skyIntensity = 0.5;
    }

    // 方块环境光 (Block Ambient)
    vec3 blockAmbient = vec3(0.0);
    if (frameUseVertexLighting()) {
        vec3 blockLightColor = vec3(1.0, 0.9, 0.7);
        // Vanilla-like non-linear light curve
        float blockIntensity = vanillaLightIntensity(blockLight);
        blockAmbient = blockLightColor * blockIntensity;
    }

    // 总环境光 (Total Ambient)
    // 漫反射环境光应随金属度衰减 (kd = 1 - metallic)
    // HACK: 保留 15% 的漫反射给金属，防止在低 IBL 环境下过暗 (1.0 - metallic * 0.85)
    // [FIX] Vertex AO 收缩逻辑
    // 原始 AO 范围: 0.5 (角落) -> 1.0 (中心)
    // 问题: 线性插值导致阴影延伸太远 (0.75 处还是很黑)
    // 方案: 对 "阴影强度" (1.0 - ao) 进行平方，使其快速衰减
    //
    // float shadow = 1.0 - ao;
    // shadow = shadow * shadow; // 0.5->0.25, 0.25->0.06
    // float sharpened_ao = 1.0 - shadow * 2.0; // 乘 2.0 恢复角落的深邃度 (0.25 * 2 = 0.5)
    //
    // 验证:
    // AO=0.5  -> shadow=0.5  -> sq=0.25   -> *2=0.5   -> new_ao=0.5 (保持最黑)
    // AO=0.75 -> shadow=0.25 -> sq=0.0625 -> *2=0.125 -> new_ao=0.875 (比原本的0.75亮多了!)
    // AO=1.0  -> shadow=0.0  -> sq=0.0    -> *2=0.0   -> new_ao=1.0

    float aoInvert = 1.0 - ao;
    float sharpened_ao = 1.0 - (aoInvert * aoInvert * 2.5); // 稍微激进一点 (2.5)，让最深处更黑一点 (1.0 - 0.25*2.5 = 0.375)
    sharpened_ao = clamp(sharpened_ao, 0.0, 1.0);

    // [New] Screen-Space Ambient Occlusion (SSAO) Integration
    if (uUseSSAO) {
        float ssao = texture(uSSAO, vUV).r;
        sharpened_ao *= ssao;
    }

    vec3 ambient = (baseAmbient * skyIntensity + blockAmbient) * albedo * sharpened_ao * uAmbientIntensity;
    ambient *= (1.0 - metallic * 0.85);

    vec3 directLight = vec3(0.0);

    // 太阳光 (Sun Light)
    // 能量守恒修复：正午时太阳光强度过高，导致反照率为 1.0 的方块过曝
    // PBRDirect 输出约等于 LightColor * NdotL
    // 我们需要按时间或太阳高度衰减 uSunColor 的总强度，或者在着色器里做 tone mapping

    vec3 L = normalize(-uSunDirection.xyz);
    vec3 shadow = vec3(1.0);
    if (frameUseShadows()) {
        shadow = ShadowCalculation(worldPos, N, L, viewDepth);
        // 如果使用了 AO，我们也稍微在阴影区应用一点额外的 AO 遮蔽
        // 这样可以防止角落的阴影区看起来太均匀
        shadow *= mix(0.5, 1.0, ao);
    }

    // RSM Logic Removed

    float sunVisibility = mix(0.05, 1.0, skyMask);

    // [FIX] 限制最大太阳光强度 (简单的 tone compress)
    vec3 sunColor = uSunColor.rgb * 0.8;

    directLight += shadow * PBRDirect(N, V, L, sunColor, albedo, roughness, F0) * sunVisibility;

    // 点光源 (Point Lights)
    if (frameUsePointLights() && uLightCount > 0) {
        if (uUseClusteredLights) {
            int clusterIndex = getClusterIndex(viewDepth, vUV);
            int count = fetchClusterCount(clusterIndex);
            int base = clusterIndex * uClusterMaxLights;

            for (int i = 0; i < MAX_CLUSTER_LIGHTS; ++i) {
                if (i >= count || i >= uClusterMaxLights) break;
                int lightIndex = fetchClusterLightIndex(base + i);
                if (lightIndex < 0 || lightIndex >= uLightCount) continue;

                vec4 p1 = texelFetch(uLightBuffer, ivec2(lightIndex, 0), 0);
                vec3 lightPos = p1.xyz;
                float radius = p1.w;

                vec3 toLight = lightPos - worldPos;
                float distSq = dot(toLight, toLight);
                if (distSq > radius * radius) continue;

                vec4 p2 = texelFetch(uLightBuffer, ivec2(lightIndex, 1), 0);
                vec3 lightColor = p2.rgb;
                float intensity = p2.w;

                float invDist = inversesqrt(distSq);
                float dist = distSq * invDist;
                float att = clamp(1.0 - dist / radius, 0.0, 1.0);
                att *= att;

                vec3 L_p = toLight * invDist;
                float vis = 1.0;
                int shadowIndex = getPointShadowIndex(lightIndex);
                if (shadowIndex >= 0) {
                    vis = samplePointShadow(shadowIndex, lightPos, radius, worldPos);
                }

                directLight +=
                    PBRDirect(N, V, L_p, lightColor * intensity, albedo, roughness, F0) * att * vis;
            }
        } else {
            const int MAX_POINT_LIGHTS = 128;
            int maxLights = min(uLightCount, MAX_POINT_LIGHTS);
            for (int i = 0; i < MAX_POINT_LIGHTS; ++i) {
                if (i >= maxLights) break;
                vec4 p1 = texelFetch(uLightBuffer, ivec2(i, 0), 0);
                vec3 lightPos = p1.xyz;
                float radius = p1.w;

                vec3 toLight = lightPos - worldPos;
                float distSq = dot(toLight, toLight);
                if (distSq > radius * radius) continue;

                vec4 p2 = texelFetch(uLightBuffer, ivec2(i, 1), 0);
                vec3 lightColor = p2.rgb;
                float intensity = p2.w;

                float invDist = inversesqrt(distSq);
                float dist = distSq * invDist;
                float att = clamp(1.0 - dist / radius, 0.0, 1.0);
                att *= att;

                vec3 L_p = toLight * invDist;
                float vis = 1.0;
                int shadowIndex = getPointShadowIndex(i);
                if (shadowIndex >= 0) {
                    vis = samplePointShadow(shadowIndex, lightPos, radius, worldPos);
                }
                directLight +=
                    PBRDirect(N, V, L_p, lightColor * intensity, albedo, roughness, F0) * att * vis;
            }
        }
    }


    // 合并自发光 (Combine Emission)
    vec3 diffuseColor = ambient + directLight;

    // IBL 近似 (IBL Approximation)
    vec3 R = reflect(-V, N);
    float envMix = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);

    // [IMPROVE] 伪 HDR 天空反射: 假设天空反射源比平均环境光亮得多 (x2.5)
    // NOTE: 不把 BlockLight 直接注入 IBL 反射，避免产生多重高光/假反射。
    vec3 skyReflectColor = uAmbientSkyColor.rgb * max(1.0, skyIntensity * 2.5);

    vec3 envColor = mix(uAmbientGroundColor.rgb, skyReflectColor, envMix);

    // [IMPROVE] 增强低粗糙度下 (光滑平面) 的反射强度
    float specResponse = 1.0 - roughness;
    specResponse *= specResponse;
    // specResponse *= specResponse; // 移除平方衰减

    // IBL 强度同时也受到金属度的影响
    vec3 F = FresnelSchlick(max(dot(N, V), 0.0), F0);
    vec3 iblSpec = F * envColor * specResponse * uIBLIntensity * ao;

    // 额外的天空反射补偿 (针对金属)
    // 如果是金属，且朝向天空，给予额外的天空光照反射，模拟简单的天空盒反射
    if (metallic > 0.5) {
        // [MODIFIED] 调整视野因子，让侧面 (N.y=0) 也能接收到完整的天空光反射
        // 使用 smoothstep(-0.5, 0.0, N.y) 确保侧面获得 1.0 的强度，只有朝下的面才会变黑
        float horizon = smoothstep(-0.5, 0.0, N.y);

        // 降低此处的倍率，因为 envColor 已经增强了
        iblSpec += F0 * skyReflectColor * horizon * specResponse * 0.4 * skyMask;
    }

    diffuseColor += iblSpec;

    // 自发光混合 (Emission Blend)
    float emissionMix = clamp(emission, 0.0, 1.0);
    vec3 emissionColor = vec3(emission) * albedo;

    vec3 color = diffuseColor * (1.0 - emissionMix) + emissionColor;

    // 后处理 (Post Processing)
    // color = ACESFilm(color);
    // color = pow(color, vec3(0.4545)); // Gamma 校正 (1.0/2.2)

    // 雾效混合 (Fog Mix)
    float dist = length(uViewPos.xyz - worldPos);
    float fogFactor = clamp((dist - frameFogStart()) / (frameFogEnd() - frameFogStart()), 0.0, 1.0);
    color = mix(color, frameFogColor(), fogFactor);

    // [DEBUG] Visualization
    // Split Screen Debug - Disabled

    // Left: SSAO Channel (White = No Occlusion, Black = Occluded)
    // fragColor = vec4(vec3(sharpened_ao), 1.0);
    // return;

    // Right: Final Composition
    fragColor = vec4(color, 1.0);
    return;

    // fragColor = vec4(vec3(sharpened_ao), 1.0); return;  // Visualize AO
    // fragColor = vec4(ambient, 1.0); return;             // Visualize Ambient + AO
    // fragColor = vec4(shadow, 1.0); return;              // Visualize Direct Shadow


    fragColor = vec4(color, 1.0);
}
