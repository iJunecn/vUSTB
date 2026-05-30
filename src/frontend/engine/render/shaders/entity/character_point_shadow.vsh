/**
 * @file character_point_shadow.vsh
 * @brief 角色点光阴影顶点着色器
 * 输入：角色顶点、实例模型矩阵、动画参数、皮肤索引、uLightViewProj
 * 输出：UV、世界空间位置、皮肤纹理层索引
 * 性能：只输出点光阴影片元所需最小插值集
 */

#version 300 es

/* 精度约定：
 * highp 用于点光光空间矩阵与世界位置输出
 */
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aUV0;
layout(location = 3) in vec4 aColor0;
layout(location = 4) in vec4 aInstanceModelRow0;
layout(location = 5) in vec4 aInstanceModelRow1;
layout(location = 6) in vec4 aInstanceModelRow2;
layout(location = 7) in vec4 aInstanceModelRow3;
layout(location = 8) in vec4 aInstanceAnimation;
layout(location = 9) in vec4 aInstanceSkin;

uniform mat4 uModel;
uniform mat4 uLightViewProj;
uniform vec4 uCharacterAnimation;
uniform float uSkinIndex;
uniform bool uUseInstanceData;

out highp vec2 vUV;
out highp vec3 vWorldPos;
out highp float vTextureIndex;

// 从顶点颜色通道恢复角色部件编号。
float decodePartId() {
    return floor(aColor0.r * 255.0 + 0.5);
}

// 绕 X 轴旋转矩阵。
mat3 rotationX(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(
        1.0, 0.0, 0.0,
        0.0, c, -s,
        0.0, s, c
    );
}

// 绕 Y 轴旋转矩阵。
mat3 rotationY(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(
        c, 0.0, s,
        0.0, 1.0, 0.0,
        -s, 0.0, c
    );
}

bool matchesPart(float partId, float firstId, float secondId) {
    return abs(partId - firstId) < 0.5 || abs(partId - secondId) < 0.5;
}

// 解析实例矩阵或回退到 uModel。
mat4 resolveModelMatrix() {
    if (!uUseInstanceData) {
        return uModel;
    }

    return mat4(
        aInstanceModelRow0,
        aInstanceModelRow1,
        aInstanceModelRow2,
        aInstanceModelRow3
    );
}

vec4 resolveCharacterAnimation() {
    return uUseInstanceData ? aInstanceAnimation : uCharacterAnimation;
}

float resolveSkinIndex() {
    return uUseInstanceData ? aInstanceSkin.x : uSkinIndex;
}

// 角色局部动画，仅影响阴影投射轮廓位置。
vec3 animatePosition(float partId, vec3 position) {
    vec4 animation = resolveCharacterAnimation();
    vec3 pivot = vec3(0.0);
    mat3 partRotation = mat3(1.0);
    bool hasRotation = false;
    float walkSwing = sin(animation.x) * 0.85 * animation.y;

    if (matchesPart(partId, 0.0, 1.0)) {
        pivot = vec3(0.0, 3.0, 0.0);
        partRotation = rotationY(animation.z) * rotationX(animation.w);
        hasRotation = abs(animation.z) > 0.0001 || abs(animation.w) > 0.0001;
    } else if (matchesPart(partId, 4.0, 5.0)) {
        pivot = vec3(-0.75, 3.0, 0.0);
        partRotation = rotationX(walkSwing);
        hasRotation = animation.y > 0.001;
    } else if (matchesPart(partId, 6.0, 7.0)) {
        pivot = vec3(0.75, 3.0, 0.0);
        partRotation = rotationX(-walkSwing);
        hasRotation = animation.y > 0.001;
    } else if (matchesPart(partId, 8.0, 9.0)) {
        pivot = vec3(-0.25, 1.5, 0.0);
        partRotation = rotationX(-walkSwing);
        hasRotation = animation.y > 0.001;
    } else if (matchesPart(partId, 10.0, 11.0)) {
        pivot = vec3(0.25, 1.5, 0.0);
        partRotation = rotationX(walkSwing);
        hasRotation = animation.y > 0.001;
    }

    if (!hasRotation) {
        return position;
    }

    return partRotation * (position - pivot) + pivot;
}

void main() {
    vec3 localPosition = animatePosition(decodePartId(), aPosition);
    vec4 worldPos = resolveModelMatrix() * vec4(localPosition, 1.0);
    gl_Position = uLightViewProj * worldPos;
    vUV = aUV0;
    vWorldPos = worldPos.xyz;
    vTextureIndex = resolveSkinIndex();
}
