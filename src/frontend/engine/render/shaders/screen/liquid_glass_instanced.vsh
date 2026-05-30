/**
 * @file liquid_glass_instanced.vsh
 * @brief 液态玻璃实例化顶点着色器
 * 输入：单位 quad 顶点、面板矩形、实例调参、视口尺寸
 * 输出：屏幕 UV、面板矩形和实例参数
 * 性能：每个实例只做一次像素到裁剪空间映射，供片元阶段读取面板参数
 */

#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec4 aPanelRect; // x, y, width, height
layout(location = 2) in vec4 aInstanceTuningA;
layout(location = 3) in vec4 aInstanceTuningB;
layout(location = 4) in vec4 aInstanceOverlayColor;

out vec2 vUV;
out vec4 vRect;
out vec4 vInstanceTuningA;
out vec4 vInstanceTuningB;
out vec4 vInstanceOverlayColor;

uniform vec2 uViewportSize;

void main() {
    vRect = aPanelRect;
    vInstanceTuningA = aInstanceTuningA;
    vInstanceTuningB = aInstanceTuningB;
    vInstanceOverlayColor = aInstanceOverlayColor;

    // 输入 quad 位于 [0,1]^2，先映射到像素空间。
    float px = aPanelRect.x + aPosition.x * aPanelRect.z;
    float py = aPanelRect.y + aPosition.y * aPanelRect.w;

    float clipX = (px / uViewportSize.x) * 2.0 - 1.0; // F(x)=px/width*2-1
    float clipY = (py / uViewportSize.y) * 2.0 - 1.0; // F(y)=py/height*2-1

    gl_Position = vec4(clipX, clipY, 0.0, 1.0);

    vUV = vec2(px / uViewportSize.x, py / uViewportSize.y);
}
