/**
 * @file selection_outline.fsh
 * @brief 选中框纯色合成片元着色器
 * 输入：uColor
 * 输出：fragColor
 * 性能：纯常量输出，无纹理采样
 */

#version 300 es
precision highp float;

uniform vec4 uColor;

out vec4 fragColor;

void main() {
    fragColor = uColor;
}
