#version 300 es
precision highp float;

/**
 * @file wboit.fsh
 * @brief WBOIT 合成阶段片元着色器
 *
 * 输入:
 *  - `uAccumulate`: 累积颜色与累积权重
 *  - `uRevealage`: 透射率累积结果
 *
 * 合成公式:
 *  finalColor.rgb = accum.rgb / max(accum.a, 0.00001)
 *  finalColor.a = 1.0 - reveal
 *
 * 输出前景颜色, 背景混合交给固定管线 Alpha Blending 完成。
 */

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uAccumulate; // Accumulation Buffer (RGBA16F)
uniform sampler2D uRevealage;  // Revealage Buffer (R8)

void main() {
    // 读取两张 WBOIT 中间结果纹理。
    vec4 accum = texture(uAccumulate, vUV);
    float reveal = texture(uRevealage, vUV).r;

    // 完全透明时直接丢弃, 避免无意义的前景混合。
    if (reveal >= 1.0) discard;

    // 平均颜色 = 累积颜色 / 累积权重。
    vec3 averageColor = accum.rgb / max(accum.a, 0.00001);

    // Revealage 越小表示前景遮挡越强。
    float alpha = 1.0 - reveal;

    // 输出前景颜色, 由标准 SRC_ALPHA / ONE_MINUS_SRC_ALPHA 与背景合成。
    fragColor = vec4(averageColor, alpha);
}
