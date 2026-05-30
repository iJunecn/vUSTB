/**
 * @file character_shadow.fsh
 * @brief 角色方向光阴影片元着色器
 * 输入：角色 UV、皮肤纹理层、纹理数组
 * 输出：fragColor
 * 性能：只做 alpha test，通过后输出常量颜色，由深度附件记录阴影深度
 */

#version 300 es

/* 精度约定：
 * highp 用于纹理数组 alpha test
 */
precision highp float;
precision highp sampler2DArray;

in highp vec2 vUV;
in highp float vTextureIndex;

uniform sampler2DArray uTextureArray;
uniform bool uHasTexture;

layout(location = 0) out vec4 fragColor;

void main() {
    vec4 texel = uHasTexture ? texture(uTextureArray, vec3(vUV, vTextureIndex)) : vec4(1.0);
    if (texel.a < 0.1) {
        discard; // cutout 空洞不投射阴影
    }

    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
