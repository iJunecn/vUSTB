#version 300 es
#ifndef SHADOW_ALPHA_TEST
#define SHADOW_ALPHA_TEST 1
#endif

#ifndef SHADOW_TRANSPARENT_COLOR
#define SHADOW_TRANSPARENT_COLOR 1
#endif

precision highp float;
precision highp sampler2DArray;

/**
 * @file shadow.fsh
 * @brief 阴影贴图生成片元着色器 (Shadow Map Generation Fragment Shader)
 *
 * 负责生成阴影深度。对于半透明物体 (如彩色玻璃)，计算光学厚度 (Optical Depth) 并写入颜色附件，
 * 以支持彩色阴影 (Colored Shadows)。
 */

// --- Inputs 输入变量 ---
in vec2 vUV;                  // 纹理坐标
in vec3 vNormal;              // 法线
flat in float vTextureIndex;  // 纹理数组索引

// --- Uniforms ---
#if SHADOW_ALPHA_TEST || SHADOW_TRANSPARENT_COLOR
uniform sampler2DArray uTextureArray; // 纹理数组
uniform bool uHasTexture;             // 是否有纹理
#endif
#if SHADOW_TRANSPARENT_COLOR
uniform bool uIsTransparent;          // 半透明标记 (Transparent Flag)
#endif

// --- Outputs 输出变量 ---
layout(location = 0) out vec4 fragColor; // 输出颜色 (ShadowColor / Transmittance Tau)

void main() {
    vec4 texColor = vec4(0.0, 0.0, 0.0, 1.0);
#if SHADOW_ALPHA_TEST || SHADOW_TRANSPARENT_COLOR
    vec3 tint = vec3(0.0);
#endif

#if SHADOW_ALPHA_TEST || SHADOW_TRANSPARENT_COLOR
    // 采样纹理 (Sample Texture)
    texColor = texture(uTextureArray, vec3(vUV, vTextureIndex));
    texColor = mix(vec4(0.0, 0.0, 0.0, 1.0), texColor, float(uHasTexture));
    tint = texColor.rgb;
#endif

#if SHADOW_ALPHA_TEST

    // 统一阴影强度 (Shadow Alpha)
    // 忽略贴图 alpha，防止图案投影。0~1，越大阴影越深
    const float SHADOW_ALPHA = 0.9;

    // Alpha 测试 (Alpha Test)
    // 镂空剔除 (仅用于裁剪，不参与强度)
    const float ALPHA_CUTOFF = 0.1;
    if (texColor.a < ALPHA_CUTOFF) {
        discard;
    }
#endif

#if SHADOW_TRANSPARENT_COLOR
    // 透明光学厚度累加 (Transparent Extinction Accumulation)
    // $$T_\text{total}(\lambda)=\prod_i e^{-\tau_i(\lambda)}=e^{-\sum_i \tau_i(\lambda)}.$$

    // 将 "RGB 吸光度" (1-Tint) 映射为 "有效光学厚度 Tau" (Spectral Optical Depth)
    // 1. 光谱->RGB 交叉吸收矩阵 (Cross Absorption Matrix)
    const mat3 CROSS_ABSORPTION_MATRIX = mat3(
  2.4968357, -0.1702115, -0.2086893,
  -0.2470291, 2.4920474, -0.2019714,
  -0.1576470, -0.2657523, 2.4835257
    );

    // 2. 计算等效光学厚度
    vec3 kappa = CROSS_ABSORPTION_MATRIX * (1.0 - tint);

    // 3. 施加厚度 (这里假设单位厚度 d=1.0)
    // 如果有不同厚度的玻璃，可乘上 uThickness
    vec3 tau = kappa * 0.6; // 稍微增强厚度感

    // 4. 限制动态范围 (防止超级黑洞)
    tau = clamp(tau, 0.0, 8.0);

    // 5. 输出
    // ShadowPass 开启 gl.blendFunc(gl.ONE, gl.ONE)
    // Tau_total = Tau1 + Tau2 + ...
    // 在 Lighting 阶段: Transmittance = exp(-Tau_total)

    fragColor = mix(vec4(0.0), vec4(tau, 0.0), float(uIsTransparent));

    // RSM Output removed for other GI implementation.
    // If not transparent (Opaque Pass):
    if (!uIsTransparent) {
        // Ensure location 0 is written (Opaque = 0 transmittance)
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
#else
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
#endif
}


