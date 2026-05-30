#version 300 es
precision highp float;

// Packed attributes
layout(location = 0) in uvec4 aTerrain0;
layout(location = 1) in uvec4 aTerrain1;

uniform mat4 uModel;
uniform mat4 uLightViewProj;

out vec2 vUV;
flat out float vTextureIndex;
out vec3 vWorldPos;

#include <common/lib/terrain_decode.glsl>

void main() {
    // Decode terrain.compact.v2 vertex
    vec3 pos = decodeTcPosition(aTerrain0);
    vec3 normal = safeNormalize(decodeNormal3x8(aTerrain0.w));
    TcUvInfo uvInfo = decodeTcUvInfo(aTerrain1);
    vec2 computedUV = resolveTcUV(uvInfo, pos, normal);

    vec4 worldPos = uModel * vec4(pos, 1.0);
    gl_Position = uLightViewProj * worldPos;

    vUV = computedUV;
    vTextureIndex = uvInfo.textureIndex;
    vWorldPos = worldPos.xyz;
}
