#version 300 es

/**
 * @file copy.glsl
 * @brief 3D 纹理切片拷贝着色器
 * 输入：uTexture（3D 纹理）
 * 输出：fragColor（当前切片颜色）
 * 性能：全屏 Quad 绘制，极低开销
 */

precision highp float;
precision highp sampler3D;

in vec2 vUV;
layout(location = 0) out vec4 fragColor;

uniform sampler3D uTexture;      // 源 3D 纹理
uniform vec3 uVolumeSize;        // 体素网格尺寸 (W, H, D)
uniform float uCurrentSliceZ;    // 当前 Z 层索引 (0, 1, 2...)

void main() {
    // 计算当前切片的归一化 Z 坐标
    // Center of voxel Z is (z + 0.5) / size.z
    highp float z = (uCurrentSliceZ + 0.5) / uVolumeSize.z; // Z 轴中心采样
    highp vec3 uvw = vec3(vUV, z);

    fragColor = texture(uTexture, uvw);
}
