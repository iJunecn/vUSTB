/**
 * @file character_depth_prepass.fsh
 * @brief 角色深度预通道片元着色器
 * 输入：角色 UV、皮肤纹理层、纹理数组
 * 输出：无颜色输出，仅通过 discard 控制深度写入
 * 性能：仅在 cutout 路径读取一次 alpha
 */

#version 300 es

/* 精度约定：
 * highp 用于纹理数组 alpha test
 */
precision highp float;
precision highp sampler2DArray;

in highp vec2 vUV;
in highp float vTextureIndex;

uniform highp sampler2DArray uTextureArray;
uniform bool uHasTexture;

void main() {
    vec4 texel = uHasTexture ? texture(uTextureArray, vec3(vUV, vTextureIndex)) : vec4(1.0);
    if (texel.a < 0.1) {
        discard; // cutout 空洞不写入深度预通道
    }
}
