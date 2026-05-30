#version 300 es
/**
 * @file ssao.vsh
 * @brief SSAO 阶段顶点着色器 (全屏四边形)
 */

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUV;

out vec2 vUV;

void main() {
    vUV = aUV;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
