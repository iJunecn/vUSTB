#version 300 es

precision highp float;
precision highp int;

/**
 * @file geometry.vsh
 * @brief 地形延迟几何阶段顶点着色器
 *
 * 输入为压缩地形顶点, 输出 G-Buffer 所需的法线、颜色、UV、材质与深度属性。
 * 本阶段使用 camera-relative 坐标减少大世界坐标下的精度损失。
 */

// 压缩地形顶点属性。
layout(location = 0) in uvec4 aTerrain0;
layout(location = 1) in uvec4 aTerrain1;

// 模型变换。
uniform mat4 uModel;
// Depth bias scale for optional slope-based depth offset.
// IMPORTANT: leaving this uniform unset defaults it to 0.0, which disables the bias.

layout(std140) uniform CameraUniforms {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    mat4 uInverseViewProj;
    vec4 uViewPos;
};
out highp vec3 vNormal;       // 世界空间法线
out highp vec2 vUV;           // 解析后的纹理坐标
out highp vec3 vColor;        // 顶点颜色
out highp vec3 vPosition;     // camera-relative 世界空间位置
out highp float vViewDepth;   // 线性视图深度
flat out highp float vTextureIndex; // 纹理数组层索引
out highp float vEmission;    // 自发光
out highp float vBlockLight;  // 方块光
out highp float vSkyLight;    // 天空光
flat out highp uint vMaterialId; // 材质 ID
out highp vec2 vDebugUV;      // Debug UV for quad visualization
flat out highp float vUseWorldUV; // 1.0 when greedy/world-uv path is used

#include <common/lib/terrain_decode.glsl>

void main() {
    // Decode terrain.compact.v2 vertex
    vec3 pos = decodeTcPosition(aTerrain0);
    vec3 normal = safeNormalize(decodeNormal3x8(aTerrain0.w));
    TcUvInfo uvInfo = decodeTcUvInfo(aTerrain1);
    vec2 computedUV = resolveTcUV(uvInfo, pos, normal);

    // 解包光照。
    uint packedTexLight = aTerrain1.y;
    float blockLight = float((packedTexLight >> 16) & 0xFFu) * INV_BYTE;
    float skyLight = float((packedTexLight >> 24) & 0xFFu) * INV_BYTE;

    // 解包颜色、自发光和材质标记。
    vec4 color = decodeUnorm4x8(aTerrain1.z);
    uint packedSurface = aTerrain1.w;
    float emission = float((packedSurface >> 8) & 0xFFu) * INV_BYTE;
    uint materialId = packedSurface & 0xFFu;

    // NOTE: Rotation logic moved to Fragment Shader for correct handling of merged quads.
    // Vertex Shader cannot handle per-block rotation within a single large quad.

    // 变换到 camera-relative 空间。
    // IMPORTANT: Use camera-relative math to avoid large-coordinate precision loss on mobile GPUs.
    // viewPos = R * (worldPos - cameraPos), where uView contains R and -R*cameraPos.
    vec4 worldPos = uModel * vec4(pos, 1.0);
    vec3 worldPosRel = worldPos.xyz - uViewPos.xyz;
    vec3 viewPos = mat3(uView) * worldPosRel;
    gl_Position = uProjection * vec4(viewPos, 1.0);

    // Positive linear view-space depth (meters)
    vViewDepth = max(0.0, -viewPos.z);

    vPosition = worldPosRel;
    vNormal = mat3(uModel) * normal;
    vUV = computedUV;
    vDebugUV = uvInfo.uv; // Pass the unpacked 0..1 per-quad UVs
    vUseWorldUV = uvInfo.useWorldUV ? 1.0 : 0.0;
    vTextureIndex = uvInfo.textureIndex;
    vColor = color.xyz;
    vEmission = emission;
    vBlockLight = blockLight;
    vSkyLight = skyLight;
    vMaterialId = materialId;
}

