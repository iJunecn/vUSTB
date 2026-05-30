/**
 * @file character_geometry.fsh
 * @brief 角色几何通道片元着色器
 * 输入：角色法线、UV、视空间深度、皮肤纹理层
 * 输出：GBuffer 四个渲染目标
 * 性能：仅在 alpha test 命中时写入 GBuffer，避免透明像素污染 MRT
 */

#version 300 es

/* 精度约定：
 * highp 用于纹理数组采样、法线和深度编码
 */
precision highp float;
precision highp sampler2DArray;

in highp vec3 vNormal;
in highp vec2 vUV;
in highp float vViewDepth;
in highp float vTextureIndex;

layout(location = 0) out vec4 gRT0;
layout(location = 1) out vec4 gRT1;
layout(location = 2) out vec4 gRT2;
layout(location = 3) out vec4 gRT3;

uniform sampler2DArray uTextureArray;
uniform bool uHasTexture;
uniform vec3 uBaseColor;
uniform float uRoughness;
uniform float uMetallic;
uniform float uCameraFar;
uniform bool uWriteLinearDepth;

// 把 [0,1] 深度打包为 RG 两个 unorm8 分量。
vec2 packUnorm16(float v01) {
    float u = floor(clamp(v01, 0.0, 1.0) * 65535.0 + 0.5);
    float hi = floor(u / 256.0);
    float lo = u - hi * 256.0;
    return vec2(hi, lo) / 255.0;
}

void main() {
    vec4 texel = uHasTexture ? texture(uTextureArray, vec3(vUV, vTextureIndex)) : vec4(1.0);
    if (texel.a < 0.1) {
    discard; // cutout 区域不写入 GBuffer
    }
    vec3 albedo = texel.rgb * uBaseColor;
    vec3 normal = normalize(vNormal);

    gRT0 = vec4(albedo, 0.0);
    gRT1 = vec4(normal * 0.5 + 0.5, 1.0);
    gRT2 = vec4(uRoughness, uMetallic, 1.0, 0.0);

    if (uWriteLinearDepth) {
      float linear01 = vViewDepth / max(uCameraFar, 0.0001); // F=depth/far
      vec2 rg = packUnorm16(linear01);
      gRT3 = vec4(rg, 0.0, 1.0);
    } else {
      gRT3 = vec4(0.0);
    }
}
