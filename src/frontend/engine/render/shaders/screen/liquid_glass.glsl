/**
 * @file liquid_glass.glsl
 * @brief 液态玻璃面板折射与高光辅助函数库
 * 输入：场景颜色纹理、面板矩形数组、屏幕纹素尺寸
 * 输出：经过折射、色散、边缘高光后的面板颜色
 * 性能：循环上限固定为 4 个 panel，模糊核半径固定为 5
 */

#define MAX_LIQUID_GLASS_PANELS 4

uniform int uLiquidGlassPanelCount;
uniform vec4 uLiquidGlassPanelRects[MAX_LIQUID_GLASS_PANELS];

// 高光主方向，决定边缘镜面条纹朝向。
const vec2 GLARE_DIR = normalize(vec2(0.72, -0.58));
const float REF_FACTOR = 82.0;
const float REF_THICKNESS = 18.0;
const float REF_DISPERSION = 6.5;
const float REF_FRESNEL_RANGE = 28.0;
const float REF_FRESNEL_HARDNESS = 2.2;
const float REF_FRESNEL_FACTOR = 0.28;
const float GLARE_FACTOR = 0.45;
const float GLARE_RANGE = 26.0;
const float GLARE_HARDNESS = 2.6;
const int BLUR_RADIUS = 5;

/**
 * 圆角矩形 signed distance。
 * @param p 局部像素坐标，原点位于面板中心
 * @param halfSize 半尺寸
 * @param cornerRadius 圆角半径
 * @return sdf，内部为负，边缘约等于 0
 */
float roundedRectSDF(vec2 p, vec2 halfSize, float cornerRadius) {
    vec2 q = abs(p) - (halfSize - vec2(cornerRadius));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cornerRadius;
}

float panelMainSDF(vec2 localPx, vec2 halfSize, float radius) {
    return roundedRectSDF(localPx, halfSize, radius);
}

vec3 sampleToneMappedScene(sampler2D sceneTexture, vec2 uv) {
    vec2 safeUv = clamp(uv, vec2(0.001), vec2(0.999));
    return ACESFilm(texture(sceneTexture, safeUv).rgb);
}

// 高斯权重，F(x)=exp(-0.5*x^2/sigma^2)
float gaussianWeight(float x, float sigma) {
    return exp(-0.5 * (x * x) / max(sigma * sigma, 0.0001));
}

/**
 * 沿指定方向做一维模糊。
 * 用于把液态玻璃的体内散射近似成 separable blur。
 */
vec3 blurDirectional(sampler2D sceneTexture, vec2 uv, vec2 texelSize, vec2 direction, float blurRadiusPx) {
    vec3 color = vec3(0.0);
    float totalWeight = 0.0;
    float sigma = max(blurRadiusPx * 0.3, 0.001);

    for (int i = -BLUR_RADIUS; i <= BLUR_RADIUS; ++i) {
        float fi = float(i);
        float weight = gaussianWeight(fi, sigma);
        vec2 offset = direction * fi * blurRadiusPx * texelSize;
        color += sampleToneMappedScene(sceneTexture, uv + offset) * weight;
        totalWeight += weight;
    }

    return color / max(totalWeight, 0.0001);
}

vec3 getBlurredScene(sampler2D sceneTexture, vec2 uv, vec2 texelSize, float blurRadiusPx) {
    vec3 horiz = blurDirectional(sceneTexture, uv, texelSize, vec2(1.0, 0.0), blurRadiusPx);
    vec3 vert = blurDirectional(sceneTexture, uv, texelSize, vec2(0.0, 1.0), blurRadiusPx);
    return mix(horiz, vert, 0.5);
}

/**
 * 用有限差分近似边缘法线。
 * dFdx/dFdy 给出屏幕空间步长，避免固定 epsilon 在缩放时失真。
 */
vec2 getNormal(vec2 localPx, vec2 halfSize, float radius) {
    vec2 h = vec2(max(abs(dFdx(localPx.x)), 0.0001), max(abs(dFdy(localPx.y)), 0.0001));
    float dx = panelMainSDF(localPx + vec2(h.x, 0.0), halfSize, radius)
             - panelMainSDF(localPx - vec2(h.x, 0.0), halfSize, radius);
    float dy = panelMainSDF(localPx + vec2(0.0, h.y), halfSize, radius)
             - panelMainSDF(localPx - vec2(0.0, h.y), halfSize, radius);
    return normalize(vec2(dx, dy) / max(2.0 * h, vec2(0.0001)) + vec2(1e-5, 0.0));
}

// 面板内部的透镜法线近似，中心较平，靠边逐渐抬升。
vec2 getLensNormal(vec2 localPx, vec2 halfSize, float radius) {
    vec2 usableHalf = max(halfSize - vec2(radius * 0.35), vec2(1.0));
    vec2 coord = clamp(localPx / usableHalf, vec2(-1.0), vec2(1.0));
    vec2 profile = sign(coord) * pow(abs(coord), vec2(1.15));
    vec2 axisWeight = vec2(
        1.0 - 0.32 * coord.y * coord.y,
        1.0 - 0.32 * coord.x * coord.x
    );
    return profile * axisWeight;
}

/**
 * 三通道色散采样。
 * 不同折射率分别偏移 R/G/B，模拟玻璃边缘的轻微分光。
 */
vec3 getBlurredDispersion(
    sampler2D sceneTexture,
    vec2 uv,
    vec2 texelSize,
    vec2 offset,
    float factor,
    float blurRadiusPx
) {
    const float N_R = 1.0;
    const float N_G = 1.025;
    const float N_B = 1.05;
    vec3 pixel;
    pixel.r = getBlurredScene(sceneTexture, uv + offset * (1.0 - (N_R - 1.0) * factor), texelSize, blurRadiusPx).r;
    pixel.g = getBlurredScene(sceneTexture, uv + offset * (1.0 - (N_G - 1.0) * factor), texelSize, blurRadiusPx).g;
    pixel.b = getBlurredScene(sceneTexture, uv + offset * (1.0 - (N_B - 1.0) * factor), texelSize, blurRadiusPx).b;
    return pixel;
}

/**
 * 把液态玻璃效果叠加到基础场景色。
 * 每个 panel 独立计算 inside、shadow、fresnel 与 glare，再逐个混合到 color。
 */
vec3 applyLiquidGlassPanels(vec3 baseColor, sampler2D sceneTexture, vec2 uv, vec2 texelSize) {
    vec2 screenSize = vec2(textureSize(sceneTexture, 0));
    vec2 fragPx = uv * screenSize;
    vec3 color = baseColor;

    for (int index = 0; index < MAX_LIQUID_GLASS_PANELS; ++index) {
        if (index >= uLiquidGlassPanelCount) {
            break;
        }

        vec4 rect = uLiquidGlassPanelRects[index];
        vec2 panelCenter = rect.xy + rect.zw * 0.5;
        vec2 localPx = fragPx - panelCenter;
        float radius = clamp(min(rect.z, rect.w) * 0.36, 24.0, 56.0);
        vec2 halfSize = rect.zw * 0.5;
        float sd = panelMainSDF(localPx, halfSize, radius);
        float inside = smoothstep(1.5, -1.5, sd);
        float edgeBand = smoothstep(GLARE_RANGE, 0.0, abs(sd));
        float shadow = (1.0 - inside) * (1.0 - smoothstep(0.0, 28.0, sd));
        vec2 edgeNormal = getNormal(localPx, halfSize, radius);

        if (inside > 0.001) {
            float blurRadiusPx = 3.0;

            vec2 lensNormal = getLensNormal(localPx, halfSize, radius);
            float bodyLensMask = smoothstep(10.0, -18.0, sd);
            float coreMask = smoothstep(6.0, -30.0, sd);
            vec2 biasDirection = normalize(localPx + vec2(halfSize.x * 0.18, -halfSize.y * 0.14) + vec2(0.001));
            vec2 refractionVector = mix(biasDirection * 0.28, lensNormal, 0.72);
            vec2 refractionOffset = refractionVector * texelSize * REF_FACTOR * (0.24 + 0.76 * coreMask) * bodyLensMask;
            vec3 refracted = getBlurredDispersion(
                sceneTexture,
                uv + refractionOffset,
                texelSize,
                refractionOffset,
                REF_DISPERSION,
                blurRadiusPx
            );

            float fresnelBase = smoothstep(REF_FRESNEL_RANGE, 0.0, abs(sd));
            float fresnel = pow(clamp(fresnelBase, 0.0, 1.0), REF_FRESNEL_HARDNESS) * REF_FRESNEL_FACTOR;
            float facing = max(dot(-edgeNormal, GLARE_DIR), 0.0);
            float glareMask = pow(facing, GLARE_HARDNESS) * edgeBand;
            float edgeFill = smoothstep(18.0, 0.0, abs(sd));
            vec3 transmission = refracted;
            transmission = mix(transmission, vec3(0.96, 0.985, 1.0), 0.15 + edgeFill * 0.06);

            vec3 highlight = vec3(0.0);
            highlight += vec3(0.28, 0.33, 0.4) * fresnel;
            highlight += vec3(0.5, 0.56, 0.64) * glareMask * GLARE_FACTOR;
            highlight += vec3(0.05, 0.06, 0.08) * edgeFill;

            color = mix(color, transmission, inside);
            color += highlight * inside;
        }

        color *= 1.0 - shadow * 0.09;
    }

    return color;
}
