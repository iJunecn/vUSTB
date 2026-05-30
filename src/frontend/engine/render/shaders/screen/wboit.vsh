#version 300 es
/**
 * @file wboit.vsh
 * @brief WBOIT 合成阶段顶点着色器
 *
 * 作用:
 *  - 生成覆盖全屏的合成四边形
 *  - 将裁剪空间顶点映射到屏幕 UV
 */

layout(location = 0) in vec2 aPos;
out vec2 vUV;

void main() {
    vUV = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
