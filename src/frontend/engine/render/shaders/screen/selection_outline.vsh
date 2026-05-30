/**
 * @file selection_outline.vsh
 * @brief 选中框顶点着色器
 * 输入：局部包围盒顶点、uModel、CameraUniforms
 * 输出：gl_Position
 * 性能：仅做一次模型到裁剪空间的矩阵乘法
 */

#version 300 es
layout(location = 0) in vec3 aPosition;

uniform mat4 uModel;

layout(std140) uniform CameraUniforms {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    mat4 uInverseViewProj;
    vec4 uViewPos;
};

void main() {
    gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}
