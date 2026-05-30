/**
 * @file ui_blur.fsh
 * @brief UI 模糊片元着色器
 * 输入：uInputTexture、方向向量、逆纹理尺寸、模糊半径
 * 输出：fragColor
 * 性能：固定最大采样半径 8，超出 `uBlurRadius` 的 tap 直接跳过
 */

#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uInputTexture;
uniform vec2 uDirection;
uniform vec2 uInverseTextureSize;
uniform float uBlurRadius;
uniform vec2 uUvOffset;
uniform vec2 uUvScale;

const int MAX_RADIUS = 8;

// 高斯核权重，F(x)=exp(-0.5*x^2/sigma^2)
float gaussianWeight(float x, float sigma) {
    return exp(-0.5 * (x * x) / max(sigma * sigma, 0.0001));
}

void main() {
    vec2 baseUv = uUvOffset + vUV * uUvScale;

    if (uBlurRadius <= 0.001) {
        fragColor = texture(uInputTexture, baseUv);
        return;
    }

    vec4 color = vec4(0.0);
    float totalWeight = 0.0;
    float sigma = max(uBlurRadius * 0.5, 0.001);

    for (int i = -MAX_RADIUS; i <= MAX_RADIUS; ++i) {
        float fi = float(i);
        if (abs(fi) > uBlurRadius + 0.5) {
            continue;
        }

        float weight = gaussianWeight(fi, sigma);
        vec2 sampleUv = clamp(baseUv + uDirection * uInverseTextureSize * fi, vec2(0.001), vec2(0.999));
        color += texture(uInputTexture, sampleUv) * weight;
        totalWeight += weight;
    }

    fragColor = color / max(totalWeight, 0.0001);
}
