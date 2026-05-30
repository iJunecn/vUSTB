/**
 * @file depth_prepass.fsh
 * @brief 深度预通道 alpha test 片元着色器
 * 输入：vUV、vTextureIndex、可选的纹理数组
 * 输出：无颜色输出，仅通过 discard 影响深度写入
 * 性能：仅在 cutout 路径读取一次 alpha，opaque 路径可被宏关闭
 */

#version 300 es

#ifndef DEPTH_PREPASS_ALPHA_TEST
#define DEPTH_PREPASS_ALPHA_TEST 1
#endif

precision highp float;
precision highp sampler2DArray;

in highp vec2 vUV;
flat in highp float vTextureIndex;
flat in highp float vUseWorldUV;

#if DEPTH_PREPASS_ALPHA_TEST
uniform highp sampler2DArray uTextureArray; // 纹理数组 alpha 通道用于 cutout 判定
#endif

void main() {
#if DEPTH_PREPASS_ALPHA_TEST
    float alpha = texture(uTextureArray, vec3(vUV, vTextureIndex)).a;
    if (alpha < 0.5) {
        discard; // 低于阈值的 texel 不参与深度预写入
    }
#endif
    // 该 pass 不输出颜色，只让深度缓冲提前填充。
}
