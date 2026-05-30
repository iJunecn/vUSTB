/**
 * @file postprocess.vsh
 * @brief 全屏后处理通用顶点着色器
 * 输入：NDC 全屏三角形/四边形顶点
 * 输出：vUV 与 gl_Position
 * 性能：只做一次 NDC 到 UV 的线性映射
 */

#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUV;

void main() {
    vUV = aPosition * 0.5 + 0.5; // F(uv)=ndc*0.5+0.5
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
