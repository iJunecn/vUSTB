/**
 * @file sky.glsl
 * @brief 天空与云层颜色工具函数
 *
 * 提供:
 * 1. `getSimpleAtmosphere(viewDir, sunDir, altitude)`: 高度感知天空散射渐变
 * 2. `getClouds(viewDir, sunDir, time, cloudCover, cameraPosWorld)`: 世界锚定云层 (射线-平面求交)
 */

// --- Constants ---
const float EARTH_RADIUS = 6371000.0;
const float ATMOSPHERE_HEIGHT = 100000.0;
const float RAYLEIGH_HEIGHT_SCALE = 8000.0;
const float MIE_HEIGHT_SCALE = 1200.0;

// 基于太阳高度的天空渐变近似, 支持摄像机高度感知。
// viewDir: 观察方向, 已归一化。
// sunDir: 太阳方向, 指向太阳, 已归一化。
// altitude: 摄像机 Y 世界坐标 (可选, 传 0.0 退化为旧行为)。
vec3 getSimpleAtmosphere(vec3 viewDir, vec3 sunDir, float altitude) {
    float sunHeight = max(sunDir.y, -0.1);

    // 高度归一化: 0 = 地面, 1 = 云层以上。
    // 游戏世界 ~300 左右是云层高度, 更高时天空变深。
    float altNorm = clamp(altitude / 500.0, 0.0, 1.0);

    // 夜晚配色。
    vec3 zenithColorNight = vec3(0.02, 0.04, 0.1);
    vec3 horizonColorNight = vec3(0.05, 0.1, 0.2);

    vec3 zenithColorDay = vec3(0.1, 0.4, 0.9);   // 天顶蓝
    vec3 horizonColorDay = vec3(0.6, 0.8, 1.0);  // 地平线亮蓝

    vec3 zenithColorSunset = vec3(0.3, 0.2, 0.5); // 黄昏天顶
    vec3 horizonColorSunset = vec3(0.9, 0.6, 0.2); // 黄昏地平线

    // 高海拔时天顶趋向深蓝/黑, 模拟大气层稀薄效果。
    vec3 zenithHighAlt = vec3(0.03, 0.08, 0.35);
    vec3 horizonHighAlt = vec3(0.2, 0.4, 0.7);

    // 根据太阳高度在昼夜与黄昏之间插值。
    float dayFactor = smoothstep(-0.2, 0.2, sunDir.y);
    float sunsetFactor = 1.0 - abs(sunDir.y + 0.1) * 3.0;
    sunsetFactor = clamp(sunsetFactor, 0.0, 1.0);

    // 先混合昼夜基色。
    vec3 zenith = mix(zenithColorNight, zenithColorDay, dayFactor);
    vec3 horizon = mix(horizonColorNight, horizonColorDay, dayFactor);

    // 再叠加黄昏染色。
    zenith = mix(zenith, zenithColorSunset, sunsetFactor * 0.5);
    horizon = mix(horizon, horizonColorSunset, sunsetFactor);

    // 高海拔混入深色天空。
    zenith = mix(zenith, zenithHighAlt, altNorm * dayFactor);
    horizon = mix(horizon, horizonHighAlt, altNorm * 0.5 * dayFactor);

    // 根据观察方向高度决定更偏向天顶还是地平线。
    float horizonMix = pow(1.0 - max(viewDir.y, 0.0), 3.0);
    vec3 skyGradient = mix(zenith, horizon, horizonMix);

    // 用一个经验项近似太阳光晕。
    float sunDot = max(dot(viewDir, sunDir), 0.0);
    float sunHalo = pow(sunDot, 400.0) * 1.5;
    float sunGlow = pow(sunDot, 8.0) * 0.3 * dayFactor;

    return skyGradient + (vec3(1.0, 0.9, 0.8) * (sunHalo + sunGlow));
}

// --- Gradient Noise (Perlin-like, 无网格伪影) ---
// 使用 fract-dot 哈希, 避免 sin() 在低端 GPU 上的精度差异。
vec3 _skyHash3(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// 2D 梯度噪声, 五次 Hermite 插值 (C2 连续, 无可见网格边界)。
// 参考: Inigo Quilez, "Gradient Noise Derivatives"
float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    // 五次插值曲线: 6t^5 - 15t^4 + 10t^3
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    // 四个角的伪随机梯度向量
    vec2 ga = _skyHash3(i + vec2(0.0, 0.0)).xy * 2.0 - 1.0;
    vec2 gb = _skyHash3(i + vec2(1.0, 0.0)).xy * 2.0 - 1.0;
    vec2 gc = _skyHash3(i + vec2(0.0, 1.0)).xy * 2.0 - 1.0;
    vec2 gd = _skyHash3(i + vec2(1.0, 1.0)).xy * 2.0 - 1.0;

    // 梯度点积
    float va = dot(ga, f - vec2(0.0, 0.0));
    float vb = dot(gb, f - vec2(1.0, 0.0));
    float vc = dot(gc, f - vec2(0.0, 1.0));
    float vd = dot(gd, f - vec2(1.0, 1.0));

    // 双线性插值
    return va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
}

// 四层 FBM, 使用梯度噪声, 旋转域打破轴对齐。
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    float totalAmp = 0.0;
    // cos(0.5)≈0.8776, sin(0.5)≈0.4794
    mat2 rot = mat2(0.8776, 0.4794, -0.4794, 0.8776);
    for (int i = 0; i < 4; ++i) {
        v += a * gnoise(p);
        totalAmp += a;
        p = rot * p * 2.02 + vec2(17.0, 31.0);
        a *= 0.5;
    }
    return v / totalAmp; // 归一化到约 [-1, 1]
}

// 世界固定云层平面, 通过射线-平面求交获得采样坐标。
// cameraPosWorld: 摄像机世界坐标。
// cloudCover: 覆盖率 [0, 1]。
vec4 getClouds(vec3 viewDir, vec3 sunDir, float time, float cloudCover, vec3 cameraPosWorld) {
    // 云层固定世界高度 (游戏坐标)。
    const float CLOUD_ALTITUDE = 300.0;
    // 云层厚度范围, 用于双层采样增加体积感。
    const float CLOUD_THICKNESS = 60.0;

    float camY = cameraPosWorld.y;

    // 射线-平面求交: t = (CLOUD_ALTITUDE - camY) / viewDir.y
    // t > 0 表示射线前方有交点。
    float denom = viewDir.y;
    if (abs(denom) < 0.01) return vec4(0.0); // 近乎水平, 退出

    float t = (CLOUD_ALTITUDE - camY) / denom;
    if (t < 0.0) return vec4(0.0); // 交点在射线身后 (在云层上方向上看)

    // 世界空间交点。
    vec2 worldHit = cameraPosWorld.xz + viewDir.xz * t;
    // 距离衰减: 远处云层逐渐淡出, 避免噪声在极远处闪烁。
    float dist = length(worldHit - cameraPosWorld.xz);
    float distFade = 1.0 - smoothstep(3000.0, 8000.0, dist);
    if (distFade < 0.01) return vec4(0.0);

    // 风场偏移 (世界空间)。
    vec2 wind = vec2(time * 15.0, time * 8.0);
    vec2 coord = (worldHit + wind) * 0.001;

    // 主层采样。
    float noiseVal = fbm(coord) * 0.5 + 0.5;
    // 第二薄层, 略微偏移高度, 增加厚度/体积感。
    float t2 = (CLOUD_ALTITUDE + CLOUD_THICKNESS - camY) / denom;
    vec2 worldHit2 = cameraPosWorld.xz + viewDir.xz * max(t2, 0.0);
    vec2 coord2 = (worldHit2 + wind) * 0.0012;
    float noiseVal2 = fbm(coord2) * 0.5 + 0.5;
    // 混合两层: 平均后密度更丰富。
    float combined = mix(noiseVal, noiseVal2, 0.35);

    // 通过 cloudCover 控制覆盖率。
    // 旧映射区间太窄，四档随机在视觉上容易压缩成两档。
    float threshold = mix(0.60, 0.28, clamp(cloudCover, 0.0, 1.0));
    float density = smoothstep(threshold, threshold + 0.24, combined);
    if (density < 0.01) return vec4(0.0);

    // 低仰角 / 远距离衰减。
    float angleFade = smoothstep(0.02, 0.15, abs(denom));
    density *= angleFade * distFade;

    // 从云层上方俯瞰时, 降低透明度避免地面被遮挡太多。
    float aboveFade = (camY > CLOUD_ALTITUDE)
        ? smoothstep(CLOUD_ALTITUDE + CLOUD_THICKNESS * 2.0, CLOUD_ALTITUDE, camY)
        : 1.0;
    density *= aboveFade;

    // 简化 Beer-Powder 光照近似。
    float sunDot = max(dot(viewDir, sunDir), 0.0);
    float scatter = pow(sunDot, 4.0) * 0.25;
    float beer = exp(-density * 2.5);
    float powder = 1.0 - exp(-density * 5.0);
    float lightEnergy = mix(beer, beer * powder, 0.6) + scatter;

    // 在背光与受光之间插值云颜色。
    vec3 cloudBright = vec3(1.0, 0.98, 0.96);
    vec3 cloudShadow = vec3(0.65, 0.68, 0.78);
    vec3 finalCloudColor = mix(cloudShadow, cloudBright, lightEnergy);

    // 用 smoothstep 给云边缘做软化。
    float alpha = smoothstep(0.0, 0.35, density) * angleFade * distFade * aboveFade;

    return vec4(finalCloudColor, alpha);
}
