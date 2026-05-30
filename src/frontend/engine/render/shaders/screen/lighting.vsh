#version 300 es
/**
 * @file lighting.vsh
 * @brief 延迟渲染光照阶段顶点着色器 (Deferred Lighting Vertex Shader)
 *
 * 负责绘制全屏四边形，用于后续的 G-Buffer 采样和光照计算。
 */

// --- Attributes 顶点属性 ---
layout(location = 0) in vec2 aPosition; // 顶点位置 (屏幕空间)
layout(location = 1) in vec2 aUV;       // 纹理坐标

// --- Outputs 输出变量 ---
out vec2 vUV; // 传递给片元着色器的纹理坐标

void main() {
    vUV = aUV;
    // 绘制全屏四边形 (Full-screen Quad)
    // Z = 0.0, W = 1.0 确保在裁剪空间中覆盖全屏
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
