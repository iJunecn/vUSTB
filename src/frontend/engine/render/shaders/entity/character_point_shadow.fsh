/**
 * @file character_point_shadow.fsh
 * @brief 角色点光阴影片元着色器
 * 输入：角色 UV、世界空间位置、皮肤纹理层、点光参数
 * 输出：归一化径向深度 `fragColor`
 * 性能：只写单通道 R32F，对应点光阴影纹理数组层
 */

#version 300 es

/* 精度约定：
 * highp 用于纹理数组 alpha test 与径向深度计算
 */
precision highp float;
precision highp sampler2DArray;

in highp vec2 vUV;
in highp vec3 vWorldPos;
in highp float vTextureIndex;

uniform sampler2DArray uTextureArray;
uniform bool uHasTexture;
uniform vec3 uLightPos;
uniform float uLightFar;

layout(location = 0) out float fragColor;

void main() {
    vec4 texel = uHasTexture ? texture(uTextureArray, vec3(vUV, vTextureIndex)) : vec4(1.0);
    if (texel.a < 0.1) {
        discard; // cutout 空洞不投射点光阴影
    }

    float depth = length(vWorldPos - uLightPos) / max(uLightFar, 0.0001); // F=d/far
    fragColor = clamp(depth, 0.0, 1.0);
}
