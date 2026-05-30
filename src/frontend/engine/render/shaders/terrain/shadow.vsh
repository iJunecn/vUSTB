#version 300 es
/**
 * @file shadow.vsh
 * @brief 阴影贴图生成顶点着色器 (Shadow Map Generation Vertex Shader)
 *
 * 负责将场景几何体变换到光空间，用于生成阴影深度贴图。
 * 包含顶点解包逻辑，与 forward.vsh 类似。
 */

// --- Attributes 顶点属性 ---
layout(location = 0) in uvec4 aTerrain0;
layout(location = 1) in uvec4 aTerrain1;

// --- Uniforms ---
uniform mat4 uModel;            // 模型矩阵 (Chunk -> World)
uniform mat4 uLightSpaceMatrix; // 光空间矩阵 (World -> Light Clip Space)

// --- Outputs 输出变量 ---
out vec2 vUV;                 // 纹理坐标
out vec3 vNormal;             // 法线 (Model Space = World Space for chunks)
flat out float vTextureIndex; // 纹理数组索引

#include <common/lib/terrain_decode.glsl>

void main() {
    // Decode terrain.compact.v2 vertex
    vec3 pos = decodeTcPosition(aTerrain0);
    vec3 normal = safeNormalize(decodeNormal3x8(aTerrain0.w));
    TcUvInfo uvInfo = decodeTcUvInfo(aTerrain1);
    vec2 computedUV = resolveTcUV(uvInfo, pos, normal);

    // 变换到光空间 (Transform to Light Space)
    vec4 worldPos = uModel * vec4(pos, 1.0);
    gl_Position = uLightSpaceMatrix * worldPos;

    vUV = computedUV;
    vTextureIndex = uvInfo.textureIndex;
    vNormal = normal;
}
