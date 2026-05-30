/**
 * @file gl.ts
 * @brief WebGL 辅助工具库
 *
 * 说明：
 *  - 封装纹理创建、Shader 编译和 Program 链接
 *  - 提供统一的错误检查与 include 预展开能力
 */

import FRAME_UNIFORMS_GLSL from '@shaders/common/lib/frame_uniforms.glsl'
import PBR_GLSL from '@shaders/common/lib/pbr.glsl'
import SHADOW_GLSL from '@shaders/common/lib/shadow.glsl'
import SKY_GLSL from '@shaders/common/lib/sky.glsl'
import TERRAIN_DECODE_GLSL from '@shaders/common/lib/terrain_decode.glsl'
import WBOIT_GLSL from '@shaders/common/lib/wboit.glsl'

const uniformLocationCache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
const uniformBlockBindingCache = new WeakMap<WebGLProgram, Map<string, number>>()

type UniformLocationMap<T extends readonly string[]> = {
  [K in T[number]]: WebGLUniformLocation | null
}

const shaderIncludeRegistry: Record<string, string> = {
  'common/lib/frame_uniforms.glsl': FRAME_UNIFORMS_GLSL,
  'common/lib/pbr.glsl': PBR_GLSL,
  'common/lib/shadow.glsl': SHADOW_GLSL,
  'common/lib/sky.glsl': SKY_GLSL,
  'common/lib/terrain_decode.glsl': TERRAIN_DECODE_GLSL,
  'common/lib/wboit.glsl': WBOIT_GLSL,
  'lib/frame_uniforms.glsl': FRAME_UNIFORMS_GLSL,
  'lib/pbr.glsl': PBR_GLSL,
  'lib/shadow.glsl': SHADOW_GLSL,
  'lib/sky.glsl': SKY_GLSL,
  'lib/wboit.glsl': WBOIT_GLSL,
  'common/pbr.glsl': PBR_GLSL,
}

const includePattern = /^\s*#include\s+[<"]([^>"]+)[>"]\s*$/gm

function preprocessShaderIncludes(source: string, seen = new Set<string>()): string {
  return source.replace(includePattern, (_fullMatch: string, includePath: string): string => {
    const includeSource = shaderIncludeRegistry[includePath]
    if (!includeSource) {
      throw new Error(`Unknown shader include: ${includePath}`)
    }

    if (seen.has(includePath)) {
      return `\n// skipped duplicate include: ${includePath}\n`
    }

    const nestedSeen = new Set(seen)
    nestedSeen.add(includePath)
    const expanded: string = preprocessShaderIncludes(includeSource, nestedSeen)
    return `\n// begin include: ${includePath}\n${expanded}\n// end include: ${includePath}\n`
  })
}

/**
 * GL Utility (WebGL 工具类)
 * 提供 WebGL 资源创建、着色器编译和程序链接的便捷方法。
 */
export const GL = {
  /**
   * 创建 2D 纹理
   * @param gl WebGL2 上下文
   * @param width 纹理宽度
   * @param height 纹理高度
   * @param options 纹理参数配置
   * @param options.internalFormat 内部格式 (如 gl.RGBA8)
   * @param options.format 像素数据格式 (如 gl.RGBA)
   * @param options.type 数据类型 (如 gl.UNSIGNED_BYTE)
   * @param options.minFilter 缩小过滤器 (默认 gl.LINEAR)
   * @param options.magFilter 放大过滤器 (默认 gl.LINEAR)
   * @param options.wrapS S轴包裹模式 (默认 gl.CLAMP_TO_EDGE)
   * @param options.wrapT T轴包裹模式 (默认 gl.CLAMP_TO_EDGE)
   * @returns 创建的 WebGLTexture 对象
   */
  createTexture(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    options: {
      internalFormat: number
      format: number
      type: number
      minFilter?: number
      magFilter?: number
      wrapS?: number
      wrapT?: number
    },
  ) {
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      options.internalFormat,
      width,
      height,
      0,
      options.format,
      options.type,
      null,
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, options.minFilter || gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, options.magFilter || gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, options.wrapS || gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, options.wrapT || gl.CLAMP_TO_EDGE)
    return texture
  },

  /**
   * 调整纹理大小
   * @param gl WebGL2 上下文
   * @param texture 目标纹理对象
   * @param width 新宽度
   * @param height 新高度
   * @param internalFormat 内部格式
   * @param format 像素数据格式
   * @param type 数据类型
   */
  resizeTexture(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    width: number,
    height: number,
    internalFormat: number,
    format: number,
    type: number,
  ) {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null)
  },

  /**
   * 创建着色器程序 (Shader Program)
   * @param gl WebGL2 上下文
   * @param vsSource 顶点着色器源码
   * @param fsSource 片元着色器源码
   * @returns 链接成功的 WebGLProgram 对象
   * @throws Error 如果链接失败
   */
  createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string) {
    const vs = GL.compileShader(gl, gl.VERTEX_SHADER, vsSource)
    const fs = GL.compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program)
      console.error('Program link error:', info)
      gl.deleteProgram(program)
      throw new Error('Program link failed')
    }
    return program
  },

  /**
   * 编译着色器 (Compile Shader)
   * @param gl WebGL2 上下文
   * @param type 着色器类型 (gl.VERTEX_SHADER 或 gl.FRAGMENT_SHADER)
   * @param source 着色器源码
   * @returns 编译成功的 WebGLShader 对象
   * @throws Error 如果编译失败
   */
  compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
    const shader = gl.createShader(type)!
    const resolvedSource = source.includes('#include') ? preprocessShaderIncludes(source) : source
    gl.shaderSource(shader, resolvedSource)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader)
      const typeName = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'
      console.error(`${typeName} Shader compile error:`, info)
      console.error('Shader source:', resolvedSource)
      gl.deleteShader(shader)
      throw new Error(`${typeName} Shader compile failed: ${info}`)
    }
    return shader
  },

  getUniformLocation(gl: WebGL2RenderingContext, program: WebGLProgram, name: string) {
    let programCache = uniformLocationCache.get(program)
    if (!programCache) {
      programCache = new Map()
      uniformLocationCache.set(program, programCache)
    }

    if (!programCache.has(name)) {
      programCache.set(name, gl.getUniformLocation(program, name))
    }

    return programCache.get(name) ?? null
  },

  getUniformLocations<const T extends readonly string[]>(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    names: T,
  ): UniformLocationMap<T> {
    const result = {} as UniformLocationMap<T>
    for (const name of names) {
      const key = name as T[number]
      result[key] = GL.getUniformLocation(gl, program, name)
    }
    return result
  },

  bindTextureUnit(
    gl: WebGL2RenderingContext,
    unit: number,
    target: number,
    texture: WebGLTexture | null,
  ) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(target, texture)
  },

  bindTextureSampler(
    gl: WebGL2RenderingContext,
    samplerLocation: WebGLUniformLocation | null,
    unit: number,
    target: number,
    texture: WebGLTexture | null,
  ) {
    GL.bindTextureUnit(gl, unit, target, texture)
    if (samplerLocation) {
      gl.uniform1i(samplerLocation, unit)
    }
  },

  clearTextureUnit(gl: WebGL2RenderingContext, unit: number, target: number) {
    GL.bindTextureUnit(gl, unit, target, null)
  },

  bindUniformBlock(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    blockName: string,
    bindingPoint: number,
  ) {
    let programCache = uniformBlockBindingCache.get(program)
    if (!programCache) {
      programCache = new Map()
      uniformBlockBindingCache.set(program, programCache)
    }

    if (programCache.get(blockName) === bindingPoint) {
      return
    }

    const blockIndex = gl.getUniformBlockIndex(program, blockName)
    if (blockIndex === gl.INVALID_INDEX) {
      return
    }

    gl.uniformBlockBinding(program, blockIndex, bindingPoint)
    programCache.set(blockName, bindingPoint)
  },
}
