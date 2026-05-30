/**
 * @file frame_uniforms.glsl
 * @brief 帧级 uniform 访问辅助函数
 * 输入：FrameUniforms UBO
 * 输出：雾参数、相机参数、渲染开关的统一读取入口
 * 性能：仅做 swizzle/比较，供多个 shader include 复用
 */

layout(std140) uniform FrameUniforms {
    vec4 uFrameFogColor;      // xyz=雾颜色，w 预留
    vec4 uFrameFogParams;     // x=start, y=end，其余分量预留
    vec4 uFrameRenderParams0; // x=near, y=far, zw=1/screenSize
    vec4 uFrameRenderParams1; // x=reverseZ, y=linearDepth, z=depthFilterMode, w=shadowBiasScale
    vec4 uFrameRenderFlags;   // x=PBR, y=shadow, z=pointLight, w=vertexLighting
    vec4 uFrameRenderParams2; // x=pointShadowBias, y=WBOIT 开关，其余分量预留
};

// 雾起点，单位与 view-space 深度保持一致。
float frameFogStart() {
    return uFrameFogParams.x;
}

float frameFogEnd() {
    return uFrameFogParams.y;
}

vec3 frameFogColor() {
    return uFrameFogColor.xyz;
}

float frameCameraNear() {
    return uFrameRenderParams0.x;
}

float frameCameraFar() {
    return uFrameRenderParams0.y;
}

vec2 frameInvScreenSize() {
    return uFrameRenderParams0.zw;
}

bool frameUseReverseZ() {
    return uFrameRenderParams1.x > 0.5;
}

bool frameUseLinearDepth() {
    return uFrameRenderParams1.y > 0.5;
}

int frameDepthFilterMode() {
    return int(uFrameRenderParams1.z + 0.5);
}

float frameShadowBiasScale() {
    return uFrameRenderParams1.w;
}

bool frameUsePBR() {
    return uFrameRenderFlags.x > 0.5;
}

bool frameUseShadows() {
    return uFrameRenderFlags.y > 0.5;
}

bool frameUsePointLights() {
    return uFrameRenderFlags.z > 0.5;
}

bool frameUseVertexLighting() {
    return uFrameRenderFlags.w > 0.5;
}

float framePointShadowBias() {
    return uFrameRenderParams2.x;
}

bool frameUseWboit() {
    return uFrameRenderParams2.y > 0.5;
}

float frameCloudCover() {
    return uFrameRenderParams2.z;
}
