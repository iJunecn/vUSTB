/**
 * @file depth_prepass.vsh
 * @brief 地形深度预通道顶点着色器
 * 输入：terrain compact 顶点包、uModel、CameraUniforms
 * 输出：gl_Position、alpha test 所需的 UV 与纹理索引
 * 性能：只解码位置与必要 UV，避免预通道做多余材质计算
 */

#version 300 es

/* 精度约定：
 * highp 用于世界坐标与深度变换
 * int 保持 highp，避免位域解包后索引抖动
 */
precision highp float;
precision highp int;

// 必须与 geometry.vsh 的输入布局完全一致，否则深度预通道与主通道会失配。
layout(location = 0) in uvec4 aTerrain0;
layout(location = 1) in uvec4 aTerrain1;

uniform mat4 uModel;

// 相机 UBO，布局需与几何通道共享同一 std140 约定。
layout(std140) uniform CameraUniforms {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    mat4 uInverseViewProj;
    vec4 uViewPos;
};

// 输出给片元着色器的 alpha test 数据。
out highp vec2 vUV;
flat out highp float vTextureIndex;
flat out highp float vUseWorldUV; // 1.0 表示启用世界空间 UV

#include <common/lib/terrain_decode.glsl>

void main() {
    // 1. 解码位置，必须与 geometry.vsh 完全同构。
    vec3 pos = decodeTcPosition(aTerrain0);

    // 用相机相对坐标减小大世界坐标的浮点误差。
    vec4 worldPos = uModel * vec4(pos, 1.0);
    vec3 worldPosRel = worldPos.xyz - uViewPos.xyz;
    vec3 viewPos = mat3(uView) * worldPosRel;
    gl_Position = uProjection * vec4(viewPos, 1.0);

    // 2. 仅解码 alpha test 必需的 UV 与纹理层索引。
    TcUvInfo uvInfo = decodeTcUvInfo(aTerrain1);
    vTextureIndex = uvInfo.textureIndex;
    vUseWorldUV = uvInfo.useWorldUV ? 1.0 : 0.0;

    if (uvInfo.useWorldUV) {
        // 世界空间 UV 依赖法线方向选择投影平面。
        vec3 normal = safeNormalize(decodeNormal3x8(aTerrain0.w));
        vUV = computeWorldUV(pos, normal);
    } else {
        vUV = uvInfo.uv;
    }
}
