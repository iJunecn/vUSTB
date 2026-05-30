/**
 * 在 GLSL 源码的 #version 指令之后注入一条 #define。
 */
export function injectShaderDefine(source: string, defineName: string, enabled: boolean): string {
  const firstNewline = source.indexOf('\n')
  if (firstNewline < 0) {
    return `${source}\n#define ${defineName} ${enabled ? 1 : 0}\n`
  }

  return `${source.slice(0, firstNewline + 1)}#define ${defineName} ${enabled ? 1 : 0}\n${source.slice(firstNewline + 1)}`
}
