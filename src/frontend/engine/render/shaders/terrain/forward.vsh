#version 300 es

/**
 * @file forward.vsh
 * @brief 地形前向渲染顶点着色器
 *
 * 输入为 `terrain.compact.v2` 压缩顶点, 负责解码法线、UV、颜色、光照和材质信息,
 * 并输出前向着色阶段需要的世界空间属性。
 */

layout(location = 0) in uvec4 aTerrain0;
layout(location = 1) in uvec4 aTerrain1;

uniform mat4 uModel;       // 模型矩阵

layout(std140) uniform CameraUniforms {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    mat4 uInverseViewProj;
    vec4 uViewPos;
};

out highp vec3 vNormal;       // 世界空间法线
out highp vec2 vUV;           // 解码后的纹理坐标
out highp vec3 vWorldPos;     // 世界空间位置
out highp vec3 vColor;        // 顶点颜色
flat out highp float vTextureIndex; // 纹理数组层索引
out highp float vEmission;    // 自发光强度
out highp float vBlockLight;  // 方块光
out highp float vSkyLight;    // 天空光
out highp float vViewDepth;   // 视图空间深度, 供阴影级联选择使用
flat out highp uint vMaterialId; // 不透明材质 ID

#include <common/lib/terrain_decode.glsl>

void main() {
    // Decode terrain.compact.v2 vertex
    vec3 pos = decodeTcPosition(aTerrain0);
    vec3 normal = safeNormalize(decodeNormal3x8(aTerrain0.w));
    TcUvInfo uvInfo = decodeTcUvInfo(aTerrain1);
    vec2 computedUV = resolveTcUV(uvInfo, pos, normal);

    // 解包光照信息。
    uint packedTexLight = aTerrain1.y;
    float blockLight = float((packedTexLight >> 16) & 0xFFu) * INV_BYTE;
    float skyLight = float((packedTexLight >> 24) & 0xFFu) * INV_BYTE;

    // 解包颜色、自发光和材质标记。
    vec4 color = decodeUnorm4x8(aTerrain1.z);
    uint packedSurface = aTerrain1.w;
    float emission = float((packedSurface >> 8) & 0xFFu) * INV_BYTE;
    uint materialId = packedSurface & 0xFFu;

    // 变换到世界空间和视图空间。
    vec4 worldPos = uModel * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    vec4 viewPos = uView * worldPos;
    vViewDepth = -viewPos.z; // 视图空间 Z 朝向相机后方, 这里转成正深度。

    gl_Position = uProjection * viewPos;
    vNormal = mat3(uModel) * normal; // 假定模型矩阵不含非均匀缩放。
    vUV = computedUV;
    vTextureIndex = uvInfo.textureIndex;
    vColor = color.xyz;
    vEmission = emission;
    vBlockLight = blockLight;
    vSkyLight = skyLight;
    vMaterialId = materialId;
}

