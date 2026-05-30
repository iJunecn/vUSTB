/**
 * @file hologram_composite.fsh
 * @brief 全息面板合成片元着色器
 * 输入：场景纹理、面板矩形、色调/样式/运动参数、时间
 * 输出：fragColor，可在透明背景下单独输出 panel alpha
 * 性能：最多处理 4 个 panel，每个 panel 只做局部 SDF 与噪声扰动
 */

#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;
out vec4 fragColor;

#define MAX_HOLOGRAM_PANELS 4

uniform sampler2D uSceneTexture;
uniform float uTime;
uniform int uHologramPanelCount;
uniform vec4 uHologramPanelRects[MAX_HOLOGRAM_PANELS];
uniform vec4 uHologramPanelTintOpacity[MAX_HOLOGRAM_PANELS];
uniform vec4 uHologramPanelStyle[MAX_HOLOGRAM_PANELS];
uniform vec4 uHologramPanelMotion[MAX_HOLOGRAM_PANELS];
uniform int uTransparentBackground;

// 圆角矩形 SDF，用于面板遮罩与边缘渐变。
float roundedRectSDF(vec2 p, vec2 halfSize, float cornerRadius) {
    vec2 q = abs(p) - (halfSize - vec2(cornerRadius));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cornerRadius;
}

// 稳定二维哈希，供 scanline/grid 扰动复用。
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(hash12(i + vec2(0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
        mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0)), u.x),
        u.y
    );
}

// 逐 panel 混合全息底色、扫描线、网格与轻微折射扰动。
vec3 applyHologramPanels(vec3 baseColor, vec2 uv) {
    vec2 screenSize = vec2(textureSize(uSceneTexture, 0));
    vec2 fragPx = uv * screenSize;
    vec3 color = baseColor;

    for (int index = 0; index < MAX_HOLOGRAM_PANELS; ++index) {
        if (index >= uHologramPanelCount) {
            break;
        }

        vec4 rect = uHologramPanelRects[index];
        vec4 tintOpacity = uHologramPanelTintOpacity[index];
        vec4 style = uHologramPanelStyle[index];
        vec4 motion = uHologramPanelMotion[index];

        vec2 center = rect.xy + rect.zw * 0.5;
        vec2 localPx = fragPx - center;
        vec2 halfSize = rect.zw * 0.5;
        float radius = clamp(motion.w, 8.0, min(rect.z, rect.w) * 0.48);
        float sd = roundedRectSDF(localPx, halfSize, radius);
        float mask = 1.0 - smoothstep(0.0, 2.5, sd);
        if (mask <= 0.0) {
            continue;
        }

        vec2 localUv = localPx / max(rect.zw, vec2(1.0)) + 0.5;
        float scanline = 0.5 + 0.5 * sin(localUv.y * style.x * 6.2831853 - uTime * motion.x * 6.2831853);
        float gridX = 1.0 - smoothstep(0.43, 0.5, abs(fract(localUv.x * motion.z) - 0.5));
        float gridY = 1.0 - smoothstep(0.45, 0.5, abs(fract(localUv.y * motion.z * 0.75) - 0.5));
        float grid = max(gridX, gridY);
        float edge = 1.0 - smoothstep(0.0, max(motion.y, 0.001), abs(sd));
        float noise = noise2(localUv * vec2(36.0, 24.0) + vec2(uTime * 0.65, -uTime * 0.35)) * 2.0 - 1.0;

        vec2 distortion = vec2(
            sin(localUv.y * 12.0 + uTime * 2.4),
            cos(localUv.x * 10.0 - uTime * 1.7)
        ) * (style.z / max(screenSize.x, 1.0));
        vec2 distortedUv = clamp(uv + distortion, vec2(0.001), vec2(0.999));
        vec3 distortedScene = texture(uSceneTexture, distortedUv).rgb;

        vec3 tint = tintOpacity.rgb;
        float opacity = clamp(tintOpacity.w, 0.0, 1.0);
        float emissiveMask = scanline * 0.34 + grid * 0.24 + edge * style.y + max(noise, 0.0) * style.w;
        vec3 emissive = tint * emissiveMask * opacity;
        vec3 panelBase = mix(distortedScene, distortedScene * 0.82 + tint * 0.18, opacity * 0.55);
        vec3 panelColor = panelBase + emissive;
        color = mix(color, panelColor, mask * opacity);
    }

    return color;
}

// 透明背景模式下输出所有 panel 遮罩的最大 alpha。
float hologramAlpha(vec2 uv) {
    vec2 screenSize = vec2(textureSize(uSceneTexture, 0));
    vec2 fragPx = uv * screenSize;
    float alpha = 0.0;

    for (int index = 0; index < MAX_HOLOGRAM_PANELS; ++index) {
        if (index >= uHologramPanelCount) {
            break;
        }

        vec4 rect = uHologramPanelRects[index];
        vec4 tintOpacity = uHologramPanelTintOpacity[index];
        vec2 center = rect.xy + rect.zw * 0.5;
        vec2 localPx = fragPx - center;
        vec2 halfSize = rect.zw * 0.5;
        float radius = clamp(uHologramPanelMotion[index].w, 8.0, min(rect.z, rect.w) * 0.48);
        float sd = roundedRectSDF(localPx, halfSize, radius);
        float mask = 1.0 - smoothstep(0.0, 2.5, sd);
        alpha = max(alpha, mask * clamp(tintOpacity.w, 0.0, 1.0));
    }

    return alpha;
}

void main() {
    vec3 baseColor = uTransparentBackground == 1
        ? vec3(0.0)
        : texture(uSceneTexture, clamp(vUV, vec2(0.001), vec2(0.999))).rgb;
    float alpha = uTransparentBackground == 1 ? hologramAlpha(vUV) : 1.0;
    fragColor = vec4(applyHologramPanels(baseColor, vUV), alpha);
}
