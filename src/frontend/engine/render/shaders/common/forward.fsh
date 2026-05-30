#version 300 es

/**
 * @file forward.fsh
 * @brief 通用前向渲染片元着色器
 *
 * 输入:
 *  - 前向阶段插值后的法线、UV、世界位置、颜色与光照
 *  - 可选的 LabPBR 法线图与材质图
 *
 * 输出:
 *  - WBOIT 双缓冲 (`accumColor`, `revealColor`)
 *  - 或标准 Alpha Blending 前景颜色
 */

precision highp float;
precision highp sampler2DArray;

// 顶点阶段传入的插值属性。
in vec3 vNormal;              // 世界空间法线
in vec2 vUV;                  // 纹理坐标
in vec3 vWorldPos;            // 世界空间位置
in vec3 vColor;               // 顶点颜色
flat in float vTextureIndex;  // 纹理数组层索引
in float vEmission;           // 自发光强度
in float vBlockLight;         // 方块光
in float vSkyLight;           // 天空光
in float vViewDepth;          // 视图空间深度
flat in uint vMaterialId;     // 材质 ID

// 透明输出缓冲。
layout(location = 0) out vec4 accumColor;
layout(location = 1) out float revealColor;

// 材质参数与贴图资源。
uniform vec4 uColor;
uniform sampler2DArray uTextureArray;   // 颜色贴图数组
uniform sampler2DArray uNormalArray;    // 法线贴图数组
uniform sampler2DArray uSpecularArray;  // LabPBR 材质贴图数组
uniform bool uHasSpecularMap;
uniform bool uHasNormalMap;
uniform bool uHasTexture;
uniform float uNormalScale;
uniform float uRoughness;
uniform float uMetallic;

layout(std140) uniform CameraUniforms {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    mat4 uInverseViewProj;
    vec4 uViewPos;
};

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

#include "lib/frame_uniforms.glsl"

// 阴影贴图资源。移动端强制使用 `highp`，避免阴影坐标精度不足。
uniform highp sampler2DArray uShadowMap;      // 级联阴影深度图
uniform highp sampler2DArray uShadowColorMap; // 彩色阴影透射图

// 点光源缓冲。每个光源占用两行 texel。
uniform sampler2D uLightBuffer; // 点光源结构化缓冲 (RGBA32F)
uniform int uLightCount;        // 点光源数量

#include "lib/pbr.glsl"
#include "lib/shadow.glsl"
#include "lib/sky.glsl"
#include "lib/wboit.glsl"

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
        // 普通玻璃: 更低粗糙度, 更高镜面覆盖。
        return makeTranslucentParams(0.2, 1.1, 0.05, 0.85, vec3(1.0));
    } else if (id == 2u) {
        // 染色玻璃: 略高粗糙度, 加强颜色染色。
        return makeTranslucentParams(0.35, 1.2, 0.05, 0.9, vec3(1.4));
    } else if (id == 3u) {
        // 冰: 更柔和的高光, 略高的基础覆盖。
        return makeTranslucentParams(0.55, 0.9, 0.2, 0.45, vec3(1.0));
    } else if (id == 6u) {
        // 史莱姆: 偏绿并降低镜面存在感。
        return makeTranslucentParams(1.2, 0.7, 0.0, 0.25, vec3(0.9, 1.02, 0.9));
    } else if (id == 7u) {
        // 蜂蜜: 偏暖色并进一步降低透明度。
        return makeTranslucentParams(1.1, 0.65, 0.0, 0.2, vec3(1.05, 0.92, 0.75));
    }
    return makeTranslucentParams(1.0, 1.0, 0.0, 0.2, vec3(1.0));
}

/**
 * PBR Direct Lighting Component Separation
 * 将直接光拆分为漫反射与镜面两部分，便于透明材质分别调制。
 */
void PBRDirectComponents(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 albedo, float roughness, vec3 F0, out vec3 outDiff, out vec3 outSpec) {
    vec3 H_unnorm = V + L;
    vec3 H = H_unnorm * inversesqrt(dot(H_unnorm, H_unnorm));

    float NDF = DistributionGGX(N, H, roughness);
    float G   = GeometrySmith(N, V, L, roughness);
    vec3 F    = FresnelSchlick(max(dot(H, V), 0.0), F0);

    highp float NdotV = max(dot(N, V), 0.0);
    highp float NdotL = max(dot(N, L), 0.0);

    vec3 specular = (NDF * G * F) / (4.0 * NdotV * NdotL + 0.0001);
    vec3 kD = (vec3(1.0) - F) * (1.0 - step(0.5, F0.r + F0.g + F0.b)); // Metalness check

    outDiff = kD * albedo * INV_PI * radiance * NdotL;
    outSpec = specular * radiance * NdotL;
}

/**
 * 切线空间基构造 (Cotangent Frame)
 * @param N 宏观法线
 * @param p 世界位置
 * @param uv 纹理坐标
 * @return TBN 矩阵
 */
mat3 cotangent_frame(vec3 N, vec3 p, vec2 uv) {
    highp vec3 dp1 = dFdx(p);
    highp vec3 dp2 = dFdy(p);
    highp vec2 duv1 = dFdx(uv);
    highp vec2 duv2 = dFdy(uv);

    highp vec3 dp2perp = cross(dp2, N);
    highp vec3 dp1perp = cross(N, dp1);
    highp vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    highp vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;

    float invmax = inversesqrt(max(dot(T,T), dot(B,B)));
    return mat3(T * invmax, B * invmax, N);
}

/**
 * LabPBR 粗糙度解码
 * @param specSample LabPBR 采样值
 * @return 粗糙度 [0.04, 1.0]
 */
float decodeLabPBRRoughness(vec4 specSample) {
    float smoothness = clamp(specSample.r, 0.0, 1.0);
    return clamp(1.0 - smoothness, 0.04, 1.0);
}

/**
 * LabPBR 孔隙度解码
 * @param specSample LabPBR 采样值
 * @return 孔隙度 [0, 1]
 */
float decodeLabPBRPorosity(vec4 specSample) {
    return clamp(specSample.b, 0.0, 1.0);
}

/**
 * LabPBR 自发光解码
 * @param specSample LabPBR 采样值
 * @param specCoords 材质采样坐标
 * @return 自发光强度
 */
float calculateLabPBREmission(vec4 specSample, vec3 specCoords) {
    float emission = specSample.a;
    float isEmissive = step(emission, 0.999);

    // 强制对比 Lod0，避免高 mip 级别引入漏光。
    float emissionLod0 = textureLod(uSpecularArray, specCoords, 0.0).a;
    emission = min(emission, emissionLod0);
    return clamp(emission, 0.0, 1.0) * isEmissive;
}

void main() {
    // 组装基础颜色与材质采样坐标。
    vec4 baseColor = uColor;
    vec3 specCoords = vec3(vUV, vTextureIndex);
    vec4 specSample = vec4(0.0);

    if (uHasTexture) {
        vec4 texColor = texture(uTextureArray, specCoords);
        // sRGB -> Linear 近似转换 (Gamma 2.0)
        texColor.rgb = texColor.rgb * texColor.rgb;
        baseColor *= texColor;
    }
    // 叠加顶点颜色。
    baseColor.rgb *= vColor;

    TranslucentMaterialParams materialParams = getTranslucentMaterialParams(vMaterialId);
    baseColor.rgb *= materialParams.colorScale;

    // 完全透明像素直接丢弃。
    if (baseColor.a < 0.1) discard;

    // 初始化 PBR 材质参数。
    vec3 albedo = baseColor.rgb;
    float roughness = uRoughness;
    float metallic = uMetallic;
    vec3 F0 = vec3(0.04);
    float porosity = 0.0;

    if (uHasSpecularMap) {
        specSample = texture(uSpecularArray, specCoords);
        roughness = decodeLabPBRRoughness(specSample);
        decodeLabPBRMetallicAndF0(specSample.g, albedo, metallic, F0);
        porosity = decodeLabPBRPorosity(specSample);

        // 孔隙度越高，漫反射越偏暗。
        albedo *= (1.0 - porosity * 0.2);
    } else {
        F0 = mix(vec3(0.04), albedo, metallic);

        // 无 LabPBR 贴图时，对高透明材质启用平滑经验值。
        if (baseColor.a < 0.95) {
             roughness = min(roughness, 0.05);
        }
    }

    roughness = clamp(roughness * materialParams.roughnessScale, 0.02, 1.0);

    vec3 N_raw = vNormal * inversesqrt(dot(vNormal, vNormal));
    // 双面渲染时按面朝向翻转法线。
    vec3 N = mix(-N_raw, N_raw, float(gl_FrontFacing));

    // 可选法线贴图重建世界空间法线。
    if (uHasNormalMap) {
        vec3 map = texture(uNormalArray, specCoords).rgb;
        map = map * 2.0 - 1.0;
        map.xy *= uNormalScale;
        map *= inversesqrt(dot(map, map));
        mat3 TBN = cotangent_frame(N, vWorldPos, vUV);
        vec3 worldNormal = TBN * map;
        N = worldNormal * inversesqrt(dot(worldNormal, worldNormal));
    }

    vec3 toView = uViewPos.xyz - vWorldPos;
    vec3 V = toView * inversesqrt(dot(toView, toView));
    vec3 L = normalize(-uSunDirection.xyz);

    // 先计算阴影遮蔽，再进入直接光累积。
    float viewDepth = vViewDepth;
    vec3 shadow = ShadowCalculation(vWorldPos, N, L, viewDepth);

    // 太阳主光。这里略微压低强度，避免透明材质高光过曝。
    vec3 sunColor = uSunColor.rgb * 0.8;

    vec3 sunDiffuse, sunSpecular;
    PBRDirectComponents(N, V, L, sunColor, albedo, roughness, F0, sunDiffuse, sunSpecular);

    vec3 LoDiffuse = shadow * sunDiffuse;
    vec3 LoSpecular = shadow * sunSpecular;

    // 方块光作为局部补光，仅在顶点光照模式下启用。
    vec3 blockAmbient = vec3(0.0);
    if (frameUseVertexLighting()) {
        vec3 blockLightColor = vec3(1.0, 0.9, 0.7);
        float blockIntensity = pow(vBlockLight, 2.2);
        blockAmbient = blockLightColor * blockIntensity;
    }

    // 环境光与天空光混合逻辑，与 lighting.fsh 保持一致。
    vec3 baseAmbient = mix(uAmbientGroundColor.rgb, uAmbientSkyColor.rgb, N.y * 0.5 + 0.5);
    // 天空光做轻度压制，防止环境面整体漂白。
    float skyIntensity = frameUseVertexLighting() ? pow(vSkyLight, 2.2) * 0.8 : 0.5;

    vec3 ambient = (baseAmbient * skyIntensity + blockAmbient) * albedo * uAmbientIntensity;
    // 金属表面减少环境漫反射占比。
    ambient *= (1.0 - metallic * 0.85);


    // 基于程序天空的简化 IBL 近似。
    vec3 R = reflect(-V, N);

    vec3 skyReflectColor = getSimpleAtmosphere(R, normalize(-uSunDirection.xyz), uViewPos.y);

    // 叠加少量云层反射，补一点高频细节。
    vec4 cloudRef = getClouds(R, normalize(-uSunDirection.xyz), uTime * 0.05, frameCloudCover(), uViewPos.xyz);
    skyReflectColor = mix(skyReflectColor, cloudRef.rgb, cloudRef.a * 0.5);

    // 地面反射退化为环境地面色。
    vec3 groundColor = uAmbientGroundColor.rgb * skyIntensity;

    // 依据反射方向在天空和地面环境之间插值。
    float horizonMix = smoothstep(-0.2, 0.2, R.y);
    vec3 envColor = mix(groundColor, skyReflectColor, horizonMix);

    // 越光滑的材质，镜面环境反射越强。
    float specResponse = 1.0 - roughness;
    specResponse *= specResponse;

    vec3 F = FresnelSchlick(max(dot(N, V), 0.0), F0);
    vec3 iblSpec = F * envColor * specResponse * uIBLIntensity;

    // 金属面额外补一点来自天空的镜面反射。
    if (metallic > 0.5) {
        float skyMask = vSkyLight;
        iblSpec += F0 * skyReflectColor * specResponse * 0.5 * skyMask;
    }

    // 累加点光源直接光。
    vec3 pointDiffuse = vec3(0.0);
    vec3 pointSpecular = vec3(0.0);
    if (frameUsePointLights() && uLightCount > 0) {
        const int MAX_POINT_LIGHTS = 128;
        int maxLights = min(uLightCount, MAX_POINT_LIGHTS);
        for (int i = 0; i < MAX_POINT_LIGHTS; ++i) {
            if (i >= maxLights) break;
            // 每个光源占两个 texel:
            // 第 0 行: (pos.xyz, radius)
            // 第 1 行: (color.rgb, intensity)
            vec4 p1 = texelFetch(uLightBuffer, ivec2(i, 0), 0);
            vec3 lightPos = p1.xyz;
            float radius = p1.w;

            vec3 toLight = lightPos - vWorldPos;
            float distSq = dot(toLight, toLight);
            if (distSq > radius * radius) continue;

            vec4 p2 = texelFetch(uLightBuffer, ivec2(i, 1), 0);
            vec3 lightColor = p2.rgb;
            float intensity = p2.w;

            float invDist = inversesqrt(distSq);
            float dist = distSq * invDist;
            float att = clamp(1.0 - dist / radius, 0.0, 1.0);
            att *= att; // 平滑距离衰减

            vec3 Lp = toLight * invDist;
            vec3 pDiff, pSpec;
            PBRDirectComponents(N, V, Lp, lightColor * intensity, albedo, roughness, F0, pDiff, pSpec);

            pointDiffuse += pDiff * att;
            pointSpecular += pSpec * att;
        }
    }

    // 提高透明表面的最小可见度，避免高光被过度稀释。
    float alpha = clamp(baseColor.a * 1.5, 0.0, 1.0);
    alpha = clamp(alpha * materialParams.alphaScale, 0.0, 1.0);
    alpha += float(vMaterialId) * 0.0;

    bool isGlass = (vMaterialId == 1u) || (vMaterialId == 2u);
    bool isIce = (vMaterialId == 3u);
    bool isThinTransmissive = isGlass || isIce;
    float fresnelWeight = 0.0;
    vec3 transmissionTint = vec3(1.0);

    if (isThinTransmissive) {
        float cosNV = clamp(dot(N, V), 0.0, 1.0);
        vec3 fresnelView = FresnelSchlick(cosNV, F0);
        fresnelWeight = clamp((fresnelView.r + fresnelView.g + fresnelView.b) * 0.3333333, 0.0, 1.0);

        vec3 tintBase = albedo;
        float maxChannel = max(max(tintBase.r, tintBase.g), tintBase.b);
        if (maxChannel > 1.0) {
            tintBase /= maxChannel;
        }
        tintBase = clamp(tintBase, 0.0, 0.999);

        vec3 absorption = max(vec3(0.0), vec3(1.0) - tintBase);
        float thickness = clamp(baseColor.a * materialParams.alphaScale * 4.0, 0.12, 3.0);
        transmissionTint = exp(-absorption * thickness);

        alpha = max(alpha, mix(0.06, 0.18, fresnelWeight));
    }

    // 重新计算参与 WBOIT 累积的覆盖率与镜面覆盖率。
    float safeAlpha = max(alpha, 0.0001);
    float coverageAlpha = clamp(max(alpha, materialParams.minCoverage), 0.0, 1.0);
    float specCoverage = clamp(max(alpha, materialParams.specularCoverage), 0.0, 1.0);

    if (isThinTransmissive) {
        coverageAlpha = max(coverageAlpha, mix(0.18, 0.36, fresnelWeight));
        specCoverage = max(specCoverage, mix(0.85, 0.98, fresnelWeight));
    }

    // WBOIT 需要颜色与 alpha 使用一致的预乘基准。
    float alphaAcc = max(alpha, 0.0001);

    // 保留镜面单独累积结果，避免与漫反射重复缩放。
    vec3 iblSpecular = iblSpec;

    // 汇总漫反射、镜面和自发光项。
    vec3 totalDiffuse = ambient + LoDiffuse + pointDiffuse;
    vec3 totalSpecular = iblSpecular + LoSpecular + pointSpecular;

    if (isThinTransmissive) {
        totalDiffuse *= transmissionTint;
        totalSpecular *= mix(1.0, 1.35, fresnelWeight);
    }

    // 将旧版顶点自发光与 LabPBR 自发光统一到同一输出项。
    vec3 emission = calculateVanillaTranslucentEmission(baseColor.rgb, vEmission);
    float labEmission = calculateLabPBREmission(specSample, specCoords);
    float useLab = step(0.01, labEmission) * float(uHasSpecularMap);
    emission = mix(emission, labEmission * baseColor.rgb, useLab);

    // 先在场景线性空间完成前景颜色合成, 再交给 WBOIT 或标准 Alpha 输出。
    vec3 finalColor = totalDiffuse + totalSpecular + emission;
    vec3 premultColor = finalColor * alphaAcc;

    // 雾效在输出前处理, 保证透明表面的前景颜色与背景雾一致。
    float dist = length(uViewPos.xyz - vWorldPos);
    float fogFactor = clamp((dist - frameFogStart()) / (frameFogEnd() - frameFogStart()), 0.0, 1.0);
    finalColor = mix(finalColor, frameFogColor(), fogFactor);
    premultColor = finalColor * alphaAcc;

    // 对透明表面使用 Weighted Blended OIT 时, 这里仍然保持线性空间结果。

    if (frameUseWboit()) {
        // --- Weighted Blended OIT Output ---

        // 用视图深度参与权重计算, 再写入双缓冲。
        WBOITAccumulate(premultColor, alphaAcc, alphaAcc, vViewDepth, accumColor, revealColor);
    } else {
        // --- Standard Alpha Blending Fallback ---
        // Standard blending expects non-premultiplied RGB + alpha
        accumColor = vec4(finalColor, alphaAcc);
        revealColor = 1.0;
    }
}

