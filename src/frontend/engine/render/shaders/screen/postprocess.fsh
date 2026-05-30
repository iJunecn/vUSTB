#version 300 es
precision highp float;
precision highp sampler2D;

/**
 * @file postprocess.fsh
 * @brief TAA (Temporal Anti-Aliasing) + Tone Mapping + Gamma Correction
 *
 * 核心算法：
 * 1. TAA (Temporal Anti-Aliasing):
 *    - 使用历史帧缓冲区进行时间域抗锯齿
 *    - 通过深度重投影计算像素速度
 *    - 3x3 邻域采样进行 Color Clamping (防止重影)
 *    - 动态混合因子 (根据速度调整)
 *
 * 2. 锐化 (Sharpening):
 *    - 5-tap 卷积核进行图像锐化
 *    - 补偿 TAA 造成的模糊
 *
 * 3. 色调映射 (Tone Mapping):
 *    - ACES Filmic Tone Mapping
 *    - 将 HDR [0, inf] 映射到 LDR [0, 1]
 *
 * 4. Gamma 校正:
 *    - 可选的 sRGB Gamma Correction
 */

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uCurrentTexture; // 当前帧 (Linear HDR)
uniform sampler2D uHistoryTexture; // 历史帧 (LDR)
uniform sampler2D uDepthTexture;   // 深度图

uniform mat4 uInverseViewProj;     // 逆视图投影矩阵 (用于重建世界坐标)
uniform mat4 uPrevViewProj;        // 上一帧视图投影矩阵 (用于重投影)

// --- Helper Functions ---

/**
 * 5-tap Sharpening Filter
 * 补偿 TAA 模糊，增强图像细节
 */
vec3 ApplySharpen(sampler2D tex, vec2 uv, vec2 size) {
    vec3 center = texture(tex, uv).rgb;
    vec3 top = texture(tex, uv + vec2(0, -1) * size).rgb;
    vec3 bottom = texture(tex, uv + vec2(0, 1) * size).rgb;
    vec3 left = texture(tex, uv + vec2(-1, 0) * size).rgb;
    vec3 right = texture(tex, uv + vec2(1, 0) * size).rgb;

    vec3 sum = top + bottom + left + right;
    float sharpFactor = 0.6; // Sharpening strength
    // Prevent negative colors (ringing artifacts)
    return max(center + (center - sum * 0.25) * sharpFactor, vec3(0.0));
}

/**
 * ACES Filmic Tone Mapping (Narkowicz 2015)
 * 高质量 HDR -> LDR 映射，保留高光细节
 */
vec3 ACESFilm(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * RGB to Luma (亮度)
 * 用于 TAA 亮度保护和 Clamp 优化
 */
float rgb2y(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(uCurrentTexture, 0));
    vec2 screenSize = vec2(textureSize(uCurrentTexture, 0));
    bool isLowRes = screenSize.y <= 540.0;

    // =========================================================================
    // STEP 1: Sample and Sharpen Current Frame
    // =========================================================================
    vec3 linearColor = ApplySharpen(uCurrentTexture, vUV, texelSize);

    // =========================================================================
    // STEP 2: Tone Mapping (HDR -> LDR)
    // =========================================================================
    vec3 color = ACESFilm(linearColor);

    // =========================================================================
    // STEP 3: 优化5: 低分辨率用2×2邻域，高分辨率用3×3
    // =========================================================================
    vec3 minColor = color;
    vec3 maxColor = color;

    // 优化5: 低分辨率下改用2×2采样减少带宽
    if (isLowRes) {
        // 2×2 neighborhood (4 samples)
        for(int x = 0; x <= 1; ++x) {
            for(int y = 0; y <= 1; ++y) {
                vec3 sRaw = texture(uCurrentTexture, vUV + vec2(x, y) * texelSize).rgb;
                vec3 s = ACESFilm(sRaw);
                minColor = min(minColor, s);
                maxColor = max(maxColor, s);
            }
        }
    } else {
        // 3×3 neighborhood (9 samples)
        for(int x = -1; x <= 1; ++x) {
            for(int y = -1; y <= 1; ++y) {
                vec3 sRaw = texture(uCurrentTexture, vUV + vec2(x, y) * texelSize).rgb;
                vec3 s = ACESFilm(sRaw);
                minColor = min(minColor, s);
                maxColor = max(maxColor, s);
            }
        }
    }

    // 优化2: 方差裁剪替代AABB，减少色块和闪烁
    vec3 mu = (minColor + maxColor) * 0.5;
    vec3 sigma = abs(maxColor - minColor) * 0.5;
    vec3 varianceMin = mu - sigma * 1.2;
    vec3 varianceMax = mu + sigma * 1.2;

    // 2. Reprojection with Depth
    float z = texture(uDepthTexture, vUV).r * 2.0 - 1.0;
    vec4 clipPos = vec4(vUV * 2.0 - 1.0, z, 1.0);
    vec4 worldPos = uInverseViewProj * clipPos;
    worldPos /= worldPos.w;

    vec4 prevClipPos = uPrevViewProj * worldPos;

    vec2 prevUV = vUV;
    if (prevClipPos.w > 0.00001) {
        prevUV = (prevClipPos.xy / prevClipPos.w) * 0.5 + 0.5;
    }

    // Check if history is valid
    bool isOffScreen = prevClipPos.w <= 0.00001 || any(lessThan(prevUV, vec2(0.0))) || any(greaterThan(prevUV, vec2(1.0)));

    if (isOffScreen) {
        fragColor = vec4(color, 1.0);
        return;
    }

    // 3. Sample History
    vec3 history = texture(uHistoryTexture, prevUV).rgb;

    // 优化2: 方差裁剪历史帧（替代原AABB + Luma保护）
    history = clamp(history, varianceMin, varianceMax);

    // 优化3: 指数blend曲线替代线性，保留长尾抗锯齿
    vec2 velocity = vUV - prevUV;
    float speedN = clamp(length(velocity * screenSize) * 0.3, 0.0, 1.0); // 归一化速度

    // exp衰减: 0px→0.90, 2px→0.20, 5px→0.05
    float blendFactor = exp(-speedN * 4.0) * 0.85 + 0.05;
    blendFactor = clamp(blendFactor, 0.03, 0.90);

    vec3 result = mix(color, history, blendFactor);

    // =========================================================================
    // 优化4: 反向锐化强度 - 静止时不锐化，微动时自动锐化
    // =========================================================================
    // 静止(blend=0.9)时sharpen=0，移动(blend=0.3)时sharpen最大
    float sharpenStrength = (0.9 - blendFactor) * 0.4;

    // 优化4续: 低分辨率直接关闭锐化避免ringing
    if (isLowRes) sharpenStrength = 0.0;

    if (sharpenStrength > 0.01) {
        vec3 top = texture(uHistoryTexture, vUV + vec2(0, -1) * texelSize).rgb;
        vec3 bottom = texture(uHistoryTexture, vUV + vec2(0, 1) * texelSize).rgb;
        vec3 left = texture(uHistoryTexture, vUV + vec2(-1, 0) * texelSize).rgb;
        vec3 right = texture(uHistoryTexture, vUV + vec2(1, 0) * texelSize).rgb;

        vec3 neighborSum = top + bottom + left + right;
        vec3 sharpenDelta = (result - neighborSum * 0.25) * sharpenStrength;
        result = max(result + sharpenDelta, vec3(0.0)); // Prevent negative values
    }

    fragColor = vec4(result, 1.0);
}
