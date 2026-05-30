/**
 * @file ssao.fsh
 * @brief 屏幕空间环境光遮蔽片元着色器
 * 输入：深度、法线、旋转噪声、半球采样核、投影矩阵
 * 输出：fragColor，表示 0..1 的遮蔽系数
 * 性能：当前 kernelSize=32，移动端可按注释降到 16
 */

#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;
out float fragColor;

uniform sampler2D uGDepth;      // 场景深度纹理
uniform sampler2D uRT1;         // 场景法线纹理 (World Space Normals)
uniform sampler2D uNoiseTexture; // 4x4 旋转噪声纹理

// SSAO 参数。
uniform vec3 uSamples[64];       // 半球采样核心
uniform float uRadius;          // 采样半径 (世界单位，如 0.5)
uniform float uBias;            // 深度偏移偏置 (防止自遮蔽，如 0.025)
uniform vec2 uScreenSize;       // 屏幕分辨率
uniform mat4 uProjection;       // 投影矩阵
uniform mat4 uInverseProjection; // 逆投影矩阵 (用于还原 View Space Position)
uniform mat4 uView;             // 视图矩阵 (用于将 World Normal 转 View Normal)

// 深度还原辅助函数。
float getLinearDepth(vec2 uv) {
    // 假设 uGDepth 存储的是 NDC 深度或透视深度。
    // 若启用 Reverse-Z，需要与 CPU 侧投影策略同步调整。
    float d = texture(uGDepth, uv).r;
    return d;
}

vec3 getViewPos(vec2 uv) {
    float z = texture(uGDepth, uv).r;
    // 把深度纹理中的 0..1 值还原到 WebGL 的 NDC z=-1..1。
    // 只要 uInverseProjection 与 CPU 侧投影矩阵严格匹配，这条路径即可兼容 Reverse-Z。
    float z_ndc = z * 2.0 - 1.0;
    vec4 clipPos = vec4(uv * 2.0 - 1.0, z_ndc, 1.0);
    vec4 viewPos = uInverseProjection * clipPos;
    return viewPos.xyz / viewPos.w;
}

vec3 getViewNormal(vec2 uv) {
    // uRT1 存储的是 World Space Normal。
    vec3 worldNormal = texture(uRT1, uv).rgb * 2.0 - 1.0; // [0,1]->[-1,1]
    // 转换到 View Space。
    return mat3(uView) * worldNormal;
}

void main() {
    const int kernelSize = 32; // 采样数，移动端可降至 16
    vec2 noiseScale = uScreenSize / 4.0; // 噪声纹理通常是 4x4

    vec3 fragPos = getViewPos(vUV);
    vec3 normal = normalize(getViewNormal(vUV));
    vec3 randomVec = normalize(texture(uNoiseTexture, vUV * noiseScale).xyz);

    // 构建 TBN，把半球采样核从切线空间转到视空间。
    vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 TBN = mat3(tangent, bitangent, normal);

    float occlusion = 0.0;

    for(int i = 0; i < kernelSize; ++i) {
        // 从切线空间转到视图空间。
        vec3 samplePos = TBN * uSamples[i];
        samplePos = fragPos + samplePos * uRadius;

        // 把采样点投影回屏幕空间。
        vec4 offset = vec4(samplePos, 1.0);
        offset = uProjection * offset;
        offset.xyz /= offset.w; // 透视除法
        offset.xyz = offset.xyz * 0.5 + 0.5; // [-1,1] -> [0,1]

        // 获取该采样点对应的实际场景深度。
        float sampleDepth = getViewPos(offset.xy).z;

        // 范围检查：若深度差过大，说明采样落在另一层几何上，用于抑制边缘 Halo。
        float rangeCheck = smoothstep(0.0, 1.0, uRadius / abs(fragPos.z - sampleDepth));

        // 视空间 Z 通常朝 -Z，若 sampleDepth 更靠近相机，则认为该方向被遮挡。
        if (sampleDepth >= samplePos.z + uBias) {
            occlusion += 1.0 * rangeCheck;
        }
    }

    occlusion = 1.0 - (occlusion / float(kernelSize));
    fragColor = occlusion;
}
