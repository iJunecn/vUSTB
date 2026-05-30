/**
 * @file point_shadow.fsh
 * @brief 点光阴影深度编码片元着色器
 * 输入：vWorldPos、点光位置/半径、可选 cutout 纹理
 * 输出：fragColor，表示归一化的点光径向深度
 * 性能：只写单通道 R32F，适合纹理数组逐面存储
 */

#version 300 es
#ifndef POINT_SHADOW_ALPHA_TEST
#define POINT_SHADOW_ALPHA_TEST 1
#endif

precision highp float;
precision highp sampler2DArray;

in vec2 vUV;
flat in float vTextureIndex;
in vec3 vWorldPos;

#if POINT_SHADOW_ALPHA_TEST
uniform sampler2DArray uTextureArray;
uniform bool uHasTexture; // 无纹理模型回退到常量 alpha=1
#endif
uniform vec3 uLightPos;
uniform float uLightFar;

layout(location = 0) out float fragColor;

void main() {
#if POINT_SHADOW_ALPHA_TEST
    vec4 texColor = texture(uTextureArray, vec3(vUV, vTextureIndex));
    texColor = mix(vec4(1.0), texColor, float(uHasTexture));

    const float ALPHA_CUTOFF = 0.1;
    if (texColor.a < ALPHA_CUTOFF) {
        discard; // cutout 空洞不应投射阴影
    }
#endif

    float depth = length(vWorldPos - uLightPos) / max(uLightFar, 0.0001); // F=d/far
    fragColor = clamp(depth, 0.0, 1.0);
}
