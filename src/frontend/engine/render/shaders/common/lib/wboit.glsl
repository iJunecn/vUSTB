/**
 * @file wboit.glsl
 * @brief WBOIT (Weighted Blended Order-Independent Transparency) 权重与累积工具
 *
 * 核心职责:
 *  - 根据视图深度计算透明片元权重
 *  - 将预乘颜色写入 Accumulation Buffer
 *  - 将透射率写入 Revealage Buffer
 *
 * 参考文献:
 *  Morgan McGuire and Louis Bavoil, "Weighted Blended Order-Independent Transparency",
 *  Journal of Computer Graphics Techniques (JCGT), vol. 2, no. 2, 122-141, 2013
 */

/**
 * WBOIT 深度权重计算 (McGuire & Bavoil Eq. 10)
 *
 * 公式: w(z) = clamp(0.03 / (10^-5 + (z/200)^4), 10^-2, 3x10^3)
 *
 * 这里使用 quartic 衰减而不是更激进的 cubic, 让中远景透明层仍然保留可分离度。
 */
float WBOITDepthWeight(float z) {
    float d = abs(z) / 200.0;
    float d2 = d * d;
    float weight = 0.03 / (1e-5 + d2 * d2);
    return clamp(weight, 1e-2, 3e3);
}

/**
 * WBOIT 颜色累积
 *
 * 输出到双缓冲:
 * - RT0 (Accumulation): vec4(premultipliedColor * weight, weight * accumAlpha)
 * - RT1 (Revealage): float(revealAlpha)
 *
 * @param premultipliedColor 预乘后的颜色, 一般为 `baseColor * alpha + specular`
 * @param accumAlpha 参与加权平均的 Alpha
 * @param revealAlpha 参与透射率累积的 Alpha
 * @param depth 视图空间深度
 * @param outAccum 输出累积缓冲
 * @param outReveal 输出透射率缓冲
 */
void WBOITAccumulate(vec3 premultipliedColor, float accumAlpha, float revealAlpha, float depth, out vec4 outAccum, out float outReveal) {
    // 论文中的核心思想: w_i = alpha_i * f(z_i)
    // Alpha 越高, 该片元在多层平均中占比越大。
    float w = WBOITDepthWeight(depth) * accumAlpha;

    // RT0 保存加权后的颜色和权重和。
    outAccum = vec4(premultipliedColor * w, accumAlpha * w);

    // RT1 保存透射率, 最终阶段通过 1 - reveal 得到前景 Alpha。
    outReveal = revealAlpha;
}

void WBOITAccumulate(vec3 premultipliedColor, float alpha, float depth, out vec4 outAccum, out float outReveal) {
    WBOITAccumulate(premultipliedColor, alpha, alpha, depth, outAccum, outReveal);
}
