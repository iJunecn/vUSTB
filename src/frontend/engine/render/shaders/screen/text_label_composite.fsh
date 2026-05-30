/**
 * @file text_label_composite.fsh
 * @brief 屏幕文字标签合成片元着色器
 * 输入：文字纹理、像素矩形、视口尺寸、透明度
 * 输出：fragColor
 * 性能：只对当前矩形区域采样，矩形外直接返回透明色
 */

#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uTextTexture;
uniform vec4 uRectPx;
uniform vec2 uViewportSize;
uniform float uOpacity;

void main() {
    vec2 fragPx = vUV * uViewportSize;
    vec2 localUv = (fragPx - uRectPx.xy) / max(uRectPx.zw, vec2(1.0));

    if (any(lessThan(localUv, vec2(0.0))) || any(greaterThan(localUv, vec2(1.0)))) {
        fragColor = vec4(0.0);
        return;
    }

    vec4 textSample = texture(uTextTexture, clamp(localUv, vec2(0.001), vec2(0.999)));
    fragColor = vec4(textSample.rgb, textSample.a * uOpacity);
}
