/**
 * @file liquid_glass_composite.fsh
 * @brief 液态玻璃实例化合成片元着色器
 * 输入：场景纹理、模糊纹理、面板实例参数、时间与调色控制项
 * 输出：fragColor，支持透明背景与面板 alpha
 * 性能：单像素只处理当前实例矩形，不遍历全屏 panel 列表
 */

#version 300 es

/* 精度约定：
 * highp 用于屏幕像素坐标、SDF、折射偏移
 * sampler2D 保持 highp，避免模糊采样边缘抖动
 */
precision highp float;
precision highp sampler2D;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSceneTexture;
uniform sampler2D uBlurTexture;
uniform vec4 uBlurRegionUvRect;
in vec4 vRect;
in vec4 vInstanceTuningA;
in vec4 vInstanceTuningB;
in vec4 vInstanceOverlayColor;
uniform float uTime;
uniform int uBlurEnabled;
uniform int uFlowEnabled;
uniform float uFlowStrength;
uniform float uFlowWidth;
uniform float uFlowFalloff;
uniform int uChromaticEnabled;
uniform float uChromaticStrength;
uniform float uChromaticWidth;
uniform float uChromaticFalloff;
uniform vec3 uChromaticOffsets;
uniform int uHighlightEnabled;
uniform float uHighlightWidth;
uniform float uHighlightAngle;
uniform float uHighlightStrength;
uniform float uHighlightRange;
uniform int uHighlightMode;
uniform int uHighlightDiagonal;
uniform int uAntiAliasingEnabled;
uniform float uAntiAliasingBlurRadius;
uniform float uAntiAliasingEdgeRange;
uniform float uAntiAliasingStrength;
uniform int uColorGradingEnabled;
uniform vec4 uBrightnessContrastSaturationHue;
uniform vec4 uExposureGammaTemperatureHighlights;
uniform vec4 uShadowsVibranceFadeoutVignetteStrength;
uniform vec2 uVignetteRadiusSoftness;
uniform vec3 uShadowColor;
uniform vec3 uMidtoneColor;
uniform vec3 uHighlightColor;
uniform int uColorOverlayEnabled;
uniform vec3 uColorOverlayColor;
uniform float uColorOverlayStrength;
uniform int uTransparentBackground;

// 边缘 fresnel 与高光条纹参数。
const float REF_FRESNEL_RANGE = 28.0;
const float REF_FRESNEL_HARDNESS = 2.2;
const float REF_FRESNEL_FACTOR = 0.30;
const float GLARE_FACTOR = 0.58;
const float GLARE_RANGE = 26.0;
const float GLARE_HARDNESS = 2.8;

// 圆角面板 SDF，返回值越小越靠近面板内部。
float roundedRectSDF(vec2 p, vec2 halfSize, float cornerRadius) {
    vec2 q = abs(p) - (halfSize - vec2(cornerRadius));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cornerRadius;
}

float panelMainSDF(vec2 localPx, vec2 halfSize, float radius) {
    return roundedRectSDF(localPx, halfSize, radius);
}

// 片元级边缘法线，供 fresnel 和高光方向判断使用。
vec2 getNormal(vec2 localPx, vec2 halfSize, float radius) {
    vec2 h = vec2(max(abs(dFdx(localPx.x)), 0.0001), max(abs(dFdy(localPx.y)), 0.0001));
    float dx = panelMainSDF(localPx + vec2(h.x, 0.0), halfSize, radius)
             - panelMainSDF(localPx - vec2(h.x, 0.0), halfSize, radius);
    float dy = panelMainSDF(localPx + vec2(0.0, h.y), halfSize, radius)
             - panelMainSDF(localPx - vec2(0.0, h.y), halfSize, radius);
    return normalize(vec2(dx, dy) / max(2.0 * h, vec2(0.0001)) + vec2(1e-5, 0.0));
}

// 面板内部透镜法线，用于把 flow 扰动与主体折射叠加。
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

// 生成稳定伪随机数，用于后续噪声与流动场。
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
        mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
        mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

// 分形噪声叠加，给液态流动提供低频到高频的细节。
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; ++octave) {
        value += amplitude * noise2(p);
        p = p * 2.03 + vec2(13.1, 7.9);
        amplitude *= 0.5;
    }
    return value;
}

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float luminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

// 温度偏移把冷暖色统一映射到乘性色偏上。
vec3 applyTemperature(vec3 color, float temperature) {
    vec3 warm = vec3(1.0, 0.92, 0.82);
    vec3 cool = vec3(0.82, 0.92, 1.0);
    vec3 tint = mix(cool, warm, temperature * 0.5 + 0.5);
    return color * tint;
}

/**
 * 面板内颜色分级。
 * 顺序固定为 brightness/exposure/contrast -> HSV -> 阴影/高光 -> gamma/vignette。
 */
vec3 applyColorGrading(vec3 color, vec2 panelUv) {
    if (uColorGradingEnabled != 1) {
        return color;
    }

    float brightness = uBrightnessContrastSaturationHue.x;
    float contrast = uBrightnessContrastSaturationHue.y;
    float saturation = uBrightnessContrastSaturationHue.z;
    float hueShift = uBrightnessContrastSaturationHue.w;
    float exposure = uExposureGammaTemperatureHighlights.x;
    float gammaValue = max(uExposureGammaTemperatureHighlights.y, 0.001);
    float temperature = uExposureGammaTemperatureHighlights.z;
    float highlights = uExposureGammaTemperatureHighlights.w;
    float shadows = uShadowsVibranceFadeoutVignetteStrength.x;
    float vibrance = uShadowsVibranceFadeoutVignetteStrength.y;
    float fadeout = uShadowsVibranceFadeoutVignetteStrength.z;
    float vignetteStrength = uShadowsVibranceFadeoutVignetteStrength.w;

    color += brightness;
    color *= exp2(exposure);
    color = (color - 0.5) * contrast + 0.5;
    color = max(color, vec3(0.0));
    color = applyTemperature(color, temperature);

    vec3 hsv = rgb2hsv(max(color, vec3(0.0)));
    hsv.x = fract(hsv.x + hueShift);
    hsv.y *= saturation;
    hsv.y += (1.0 - hsv.y) * vibrance * (1.0 - hsv.y);
    color = hsv2rgb(vec3(hsv.x, clamp(hsv.y, 0.0, 2.0), hsv.z));

    float luma = luminance(color);
    color += uShadowColor * clamp((1.0 - luma) * max(shadows, 0.0), 0.0, 1.0);
    color += uMidtoneColor * clamp(1.0 - abs(luma - 0.5) * 2.0, 0.0, 1.0);
    color += uHighlightColor * clamp(luma * max(highlights, 0.0), 0.0, 1.0);

    if (shadows != 0.0) {
        color = mix(color, color + vec3((1.0 - luma) * shadows), clamp(1.0 - luma, 0.0, 1.0));
    }
    if (highlights != 0.0) {
        color = mix(color, color + vec3(luma * highlights), clamp(luma, 0.0, 1.0));
    }

    color = pow(max(color, vec3(0.0)), vec3(1.0 / gammaValue));
    color = mix(color, mix(color, vec3(luma), 0.15), fadeout);

    if (vignetteStrength > 0.0) {
        float vignetteRadius = uVignetteRadiusSoftness.x;
        float vignetteSoftness = max(uVignetteRadiusSoftness.y, 0.001);
        float dist = distance(panelUv, vec2(0.5));
        float vignette = smoothstep(vignetteRadius, vignetteRadius - vignetteSoftness, dist);
        color *= 1.0 - vignette * vignetteStrength;
    }

    return max(color, vec3(0.0));
}

/**
 * 采样折射后的场景颜色。
 * blur 开启时优先使用预模糊纹理，超出 blur 区域则回退到原场景采样。
 */
vec3 sampleBlurredDispersion(vec2 uv, vec2 offset, float chromaticMask, float chromaticStrengthScale, float blurMix) {
    vec2 safeUv = clamp(uv, vec2(0.001), vec2(0.999));

    if (uBlurEnabled != 1) {
        if (uChromaticEnabled != 1 || chromaticMask <= 0.0) {
            return texture(uSceneTexture, safeUv).rgb;
        }

        vec2 chromaticDirection = normalize(offset + vec2(1e-5, 0.0));
        vec2 chromaticOffset = chromaticDirection * (uChromaticStrength * chromaticMask * chromaticStrengthScale)
            / max(vec2(textureSize(uSceneTexture, 0)).x, 1.0);
        vec2 redUv = clamp(safeUv + chromaticOffset * uChromaticOffsets.x, vec2(0.001), vec2(0.999));
        vec2 greenUv = clamp(safeUv + chromaticOffset * uChromaticOffsets.y, vec2(0.001), vec2(0.999));
        vec2 blueUv = clamp(safeUv + chromaticOffset * uChromaticOffsets.z, vec2(0.001), vec2(0.999));
        return vec3(
            texture(uSceneTexture, redUv).r,
            texture(uSceneTexture, greenUv).g,
            texture(uSceneTexture, blueUv).b
        );
    }

    vec3 sharpScene = texture(uSceneTexture, safeUv + offset * 0.18).rgb;
    vec3 blurredScene;

    vec2 chromaticDirection = normalize(offset + vec2(1e-5, 0.0));
    vec2 chromaticOffset = chromaticDirection * (uChromaticStrength * chromaticMask * chromaticStrengthScale) / max(vec2(textureSize(uSceneTexture, 0)).x, 1.0);

    vec2 redUv = safeUv + offset * 1.08 + chromaticOffset * uChromaticOffsets.x;
    vec2 greenUv = safeUv + offset * 1.02 + chromaticOffset * uChromaticOffsets.y;
    vec2 blueUv = safeUv + offset * 0.96 + chromaticOffset * uChromaticOffsets.z;

    vec2 blurUvR = (redUv - uBlurRegionUvRect.xy) / max(uBlurRegionUvRect.zw, vec2(0.0001));
    vec2 blurUvG = (greenUv - uBlurRegionUvRect.xy) / max(uBlurRegionUvRect.zw, vec2(0.0001));
    vec2 blurUvB = (blueUv - uBlurRegionUvRect.xy) / max(uBlurRegionUvRect.zw, vec2(0.0001));

    blurredScene.r = all(greaterThanEqual(blurUvR, vec2(0.0))) && all(lessThanEqual(blurUvR, vec2(1.0)))
        ? texture(uBlurTexture, clamp(blurUvR, vec2(0.001), vec2(0.999))).r
        : texture(uSceneTexture, clamp(redUv, vec2(0.001), vec2(0.999))).r;
    blurredScene.g = all(greaterThanEqual(blurUvG, vec2(0.0))) && all(lessThanEqual(blurUvG, vec2(1.0)))
        ? texture(uBlurTexture, clamp(blurUvG, vec2(0.001), vec2(0.999))).g
        : texture(uSceneTexture, clamp(greenUv, vec2(0.001), vec2(0.999))).g;
    blurredScene.b = all(greaterThanEqual(blurUvB, vec2(0.0))) && all(lessThanEqual(blurUvB, vec2(1.0)))
        ? texture(uBlurTexture, clamp(blurUvB, vec2(0.001), vec2(0.999))).b
        : texture(uSceneTexture, clamp(blueUv, vec2(0.001), vec2(0.999))).b;

    return mix(sharpScene, blurredScene, blurMix);
}

/**
 * 组合当前实例的液态玻璃面板。
 * 只处理单个 vRect，对应 InstancedQuad 输出的一块屏幕矩形。
 */
vec3 applyLiquidGlassPanels(vec3 baseColor, vec2 uv) {
    vec2 screenSize = vec2(textureSize(uSceneTexture, 0));
    vec2 texelSize = 1.0 / screenSize;
    vec2 fragPx = uv * screenSize;
    vec3 color = baseColor;
    vec2 highlightDir = normalize(vec2(cos(uHighlightAngle), -sin(uHighlightAngle)) + vec2(1e-5, 0.0));

    vec4 rect = vRect;
        float blurMix = clamp(vInstanceTuningA.y, 0.0, 1.0);
        float flowStrengthScale = max(vInstanceTuningA.z, 0.0);
        float chromaticStrengthScale = max(vInstanceTuningA.w, 0.0);
        float highlightStrengthScale = max(vInstanceTuningB.x, 0.0);
        float overlayStrengthScale = max(vInstanceTuningB.y, 0.0);
        float opacity = clamp(vInstanceTuningB.z, 0.0, 1.0);
        vec3 overlayColor = length(vInstanceOverlayColor.rgb) > 0.001 ? vInstanceOverlayColor.rgb : uColorOverlayColor;

        vec2 panelCenter = rect.xy + rect.zw * 0.5;
        vec2 localPx = fragPx - panelCenter;
        vec2 halfSize = rect.zw * 0.5;
        float radius = vInstanceTuningA.x > 0.0
            ? min(vInstanceTuningA.x, min(rect.z, rect.w) * 0.5)
            : clamp(min(rect.z, rect.w) * 0.36, 24.0, 56.0);
        float sd = panelMainSDF(localPx, halfSize, radius);
        float inside = smoothstep(1.5, -1.5, sd);

        if (inside > 0.001) {

        float edgeBand = smoothstep(max(uHighlightWidth, 0.001), 0.0, abs(sd));
        float bodyMask = smoothstep(12.0, -18.0, sd);
        float coreMask = smoothstep(8.0, -30.0, sd);
        vec2 edgeNormal = getNormal(localPx, halfSize, radius);
        vec2 lensNormal = getLensNormal(localPx, halfSize, radius);
        vec2 panelUv = clamp(localPx / max(halfSize, vec2(1.0)) * 0.5 + 0.5, vec2(0.0), vec2(1.0));
        float flowMask = uFlowEnabled == 1
            ? pow(clamp(1.0 - abs(sd) / max(uFlowWidth, 0.001), 0.0, 1.0), max(uFlowFalloff, 0.001))
            : 0.0;
        float chromaticMask = uChromaticEnabled == 1
            ? pow(clamp(1.0 - abs(sd) / max(uChromaticWidth, 0.001), 0.0, 1.0), max(uChromaticFalloff, 0.001))
            : 0.0;

        float flowA = fbm(panelUv * vec2(3.6, 2.9) + vec2(uTime * 0.08, -uTime * 0.05));
        float flowB = fbm(panelUv.yx * vec2(4.1, 3.7) + vec2(-uTime * 0.06, uTime * 0.09) + 11.7);
        vec2 flowDir = normalize(vec2(flowA - 0.5, flowB - 0.5) + vec2(0.001, 0.0));

        vec2 flowOffset = flowDir * texelSize * (uFlowStrength * flowStrengthScale * 2.0 + flowA * uFlowStrength * flowStrengthScale * 4.0) * flowMask * bodyMask;
        vec2 lensOffset = lensNormal * texelSize * 34.0 * (0.22 + 0.78 * coreMask) * bodyMask;
        vec2 refractionOffset = flowOffset + lensOffset;

        vec3 transmission = sampleBlurredDispersion(
            uv + refractionOffset,
            refractionOffset,
            chromaticMask,
            chromaticStrengthScale,
            blurMix
        );
        transmission = mix(transmission, vec3(0.95, 0.975, 1.0), 0.12 + edgeBand * 0.08);
        if (uAntiAliasingEnabled == 1) {
            float aaMask = pow(clamp(1.0 - abs(sd) / max(uAntiAliasingEdgeRange, 0.001), 0.0, 1.0), 1.2);
            vec3 aaBlur = sampleBlurredDispersion(
                uv,
                edgeNormal * texelSize * uAntiAliasingBlurRadius,
                0.0,
                chromaticStrengthScale,
                blurMix
            );
            transmission = mix(transmission, aaBlur, aaMask * uAntiAliasingStrength);
        }

        float fresnelBase = smoothstep(REF_FRESNEL_RANGE, 0.0, abs(sd));
        float fresnel = pow(clamp(fresnelBase, 0.0, 1.0), REF_FRESNEL_HARDNESS) * REF_FRESNEL_FACTOR;
        float facing = max(dot(-edgeNormal, highlightDir), 0.0);
        float coverageMask = smoothstep(max(0.0, 1.0 - max(uHighlightRange, 0.001)), 1.0, facing);
        float glareMask = uHighlightEnabled == 1 ? pow(coverageMask, GLARE_HARDNESS) * edgeBand * uHighlightStrength * highlightStrengthScale : 0.0;
        float stroke = smoothstep(4.0, -1.0, sd) * (1.0 - smoothstep(10.0, 2.0, abs(sd)));
        float diagonalMask = uHighlightDiagonal == 1
            ? pow(clamp(dot(normalize(localPx + vec2(1e-5, 0.0)), highlightDir) * 0.5 + 0.5, 0.0, 1.0), 2.0)
            : 0.0;
        float innerLift = smoothstep(18.0, -20.0, sd) * (0.4 + 0.6 * flowB + diagonalMask * 0.4);

        vec3 highlight = vec3(0.0);
        if (uHighlightEnabled == 1) {
            if (uHighlightMode == 0) {
                highlight += vec3(1.0) * (fresnel * 0.8 + glareMask * GLARE_FACTOR * 0.9);
            } else {
                highlight += vec3(0.30, 0.34, 0.40) * fresnel;
                highlight += vec3(0.56, 0.62, 0.72) * glareMask * GLARE_FACTOR;
            }
            highlight += vec3(0.09, 0.11, 0.14) * stroke * uHighlightStrength * highlightStrengthScale;
            highlight += vec3(0.03, 0.04, 0.06) * innerLift * uHighlightStrength * highlightStrengthScale;
        }

        vec3 panelColor = transmission + highlight;
        panelColor = applyColorGrading(panelColor, panelUv);
        if (uColorOverlayEnabled == 1) {
            panelColor = mix(panelColor, overlayColor, uColorOverlayStrength * overlayStrengthScale);
        }

        color = mix(color, panelColor, inside * opacity);
    }
    return color;
}

// 透明背景模式下只输出面板覆盖区 alpha。
float liquidGlassAlpha(vec2 uv) {
    vec2 screenSize = vec2(textureSize(uSceneTexture, 0));
    vec2 fragPx = uv * screenSize;
    vec2 panelCenter = vRect.xy + vRect.zw * 0.5;
    vec2 localPx = fragPx - panelCenter;
    vec2 halfSize = vRect.zw * 0.5;
    float radius = vInstanceTuningA.x > 0.0
        ? min(vInstanceTuningA.x, min(vRect.z, vRect.w) * 0.5)
        : clamp(min(vRect.z, vRect.w) * 0.36, 24.0, 56.0);
    return smoothstep(1.5, -1.5, panelMainSDF(localPx, halfSize, radius)) * clamp(vInstanceTuningB.z, 0.0, 1.0);
}

void main() {
    vec3 baseColor = uTransparentBackground == 1
        ? vec3(0.0)
        : texture(uSceneTexture, clamp(vUV, vec2(0.001), vec2(0.999))).rgb;
    float alpha = uTransparentBackground == 1 ? liquidGlassAlpha(vUV) : 1.0;
    fragColor = vec4(applyLiquidGlassPanels(baseColor, vUV), alpha);
}
