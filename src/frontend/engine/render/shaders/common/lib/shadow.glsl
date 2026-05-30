/**
 * @file shadow.glsl
 * @brief CSM (Cascaded Shadow Maps) 级联阴影计算
 *
 * 核心功能:
 *  - 级联阴影贴图采样
 *  - 旋转 PCF 软阴影
 *  - 彩色阴影透射率计算 (Beer-Lambert Law)
 *  - 法线偏移防止阴影失真
 *
 * 依赖: pbr.glsl (InterleavedGradientNoise)
 */

/**
 * 级联阴影计算 (CSM Shadow Calculation)
 *
 * 算法流程:
 * 1. 根据视图深度选择级联层级 (Cascade Selection)
 * 2. 应用法线偏移防止阴影失真 (Normal Bias)
 * 3. 转换到光空间并计算投影坐标 (Light Space Transform)
 * 4. 旋转PCF采样 (Rotated 3x3 PCF)
 * 5. 混合彩色阴影透射率 (Colored Shadow Transmittance)
 *
 * @param worldPos 世界空间坐标
 * @param N 表面法线
 * @param L 光照方向 (指向光源)
 * @param viewDepth 视图空间深度 (负 Z)
 * @return 阴影因子 vec3 (1.0 = 无阴影, 0.0 = 全阴影, RGB = 彩色透射率)
 */
vec3 ShadowCalculation(vec3 worldPos, vec3 N, vec3 L, float viewDepth) {
    float cIdx = 2.0;
    cIdx = mix(cIdx, 1.0, step(viewDepth, uCascadeSplits[1]));
    cIdx = mix(cIdx, 0.0, step(viewDepth, uCascadeSplits[0]));
    int cascadeIndex = int(cIdx);

    float cosTheta = clamp(dot(N, L), 0.0, 1.0);
    float normalBias = 0.01 + 0.02 * (1.0 - cosTheta);
    vec3 shadowWorldPos = worldPos + N * normalBias;

    vec4 fragPosLightSpace = uLightSpaceMatrices[cascadeIndex] * vec4(shadowWorldPos, 1.0);
    vec3 projCoords = fragPosLightSpace.xyz / fragPosLightSpace.w;
    projCoords = projCoords * 0.5 + 0.5;

    if (
        projCoords.x < 0.0 || projCoords.x > 1.0 ||
        projCoords.y < 0.0 || projCoords.y > 1.0 ||
        projCoords.z < 0.0 || projCoords.z > 1.0
    ) {
        return vec3(1.0);
    }

    float currentDepth = projCoords.z;
    float bias = 0.0000003 * float((cascadeIndex + 1) * 5) * frameShadowBiasScale();

    float shadow = 0.0;
    vec2 texelSize = 1.0 / vec2(textureSize(uShadowMap, 0).xy);

    // 不要直接用 gl_FragCoord 做随机种子。
    // 屏幕空间噪声会锁在屏幕上, 导致相机转动时出现条纹漂移。
    // 这里改用 shadow-map texel 空间坐标做种子, 让旋转核与阴影贴图对齐。
    vec2 shadowTexelXY = projCoords.xy * vec2(textureSize(uShadowMap, 0).xy);
    float noise = InterleavedGradientNoise(floor(shadowTexelXY) + float(cascadeIndex) * 17.0);
    float angle = noise * 6.28318530718;
    float s = sin(angle);
    float c = cos(angle);
    mat2 rotation = mat2(c, -s, s, c);

    float radius = 1.5;
    vec2 rTexel = texelSize * radius;
    float depthBias = currentDepth - bias;

    vec2 offset;
    offset = rotation * (vec2(-1.0, -1.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);
    offset = rotation * (vec2( 0.0, -1.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);
    offset = rotation * (vec2( 1.0, -1.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);

    offset = rotation * (vec2(-1.0,  0.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);
    offset = rotation * (vec2( 0.0,  0.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);
    offset = rotation * (vec2( 1.0,  0.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);

    offset = rotation * (vec2(-1.0,  1.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);
    offset = rotation * (vec2( 0.0,  1.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);
    offset = rotation * (vec2( 1.0,  1.0) * rTexel);
    shadow += step(texture(uShadowMap, vec3(projCoords.xy + offset, float(cascadeIndex))).r, depthBias);

    shadow *= 0.111111;

    float facingLight = step(0.0, dot(N, L));
    float visibility = (1.0 - shadow) * facingLight;

    vec4 shadowColor = texture(uShadowColorMap, vec3(projCoords.xy, float(cascadeIndex)));
    vec3 transmittance = exp(-shadowColor.rgb);

    return visibility * transmittance;
}

