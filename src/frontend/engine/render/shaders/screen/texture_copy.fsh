/**
 * @file texture_copy.fsh
 * @brief 纹理拷贝片元着色器
 * 输入：uTexture、vUV
 * 输出：fragColor
 * 性能：单次纹理读取，主要用于 blit 与中间结果复制
 */

#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uTexture;

void main() {
    fragColor = texture(uTexture, clamp(vUV, vec2(0.001), vec2(0.999)));
}
