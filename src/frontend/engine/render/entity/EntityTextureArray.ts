type NormalizeInputImageSource = CanvasImageSource & { width: number; height: number }

export type EntityTextureArrayOptions = {
  textureWidth: number
  textureHeight: number
  capacity: number
  label: string
  normalizeSource?: (source: NormalizeInputImageSource) => TexImageSource
}

function createTextureCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function defaultNormalizeSource(
  source: NormalizeInputImageSource,
  width: number,
  height: number,
): TexImageSource {
  const canvas = createTextureCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to create entity texture normalization canvas')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, width, height)
  return canvas
}

export function loadEntityImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load entity texture: ${url}`))
    image.src = url
  })
}

/**
 * render/entity 根层的通用 2D texture array 管理器。
 *
 * 负责图片加载、归一化、上传和 layer 索引分配。
 * 子域可通过 `normalizeSource` 叠加角色皮肤镜像修正、方块实体贴图裁切等规则。
 */
export class EntityTextureArray {
  private readonly texture: WebGLTexture
  private readonly indices = new Map<string, number>()
  private nextLayer = 0

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly options: EntityTextureArrayOptions,
  ) {
    const texture = gl.createTexture()
    if (!texture) {
      throw new Error(`Failed to create ${options.label} texture array`)
    }

    this.texture = texture
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture)
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA8,
      options.textureWidth,
      options.textureHeight,
      options.capacity,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
  }

  public async ensureTexture(textureId: string, url: string): Promise<number> {
    const existing = this.indices.get(textureId)
    if (existing !== undefined) {
      return existing
    }

    if (this.nextLayer >= this.options.capacity) {
      throw new Error(
        `${this.options.label} texture array capacity exceeded (${this.options.capacity})`,
      )
    }

    const image = await loadEntityImage(url)
    const normalized = this.options.normalizeSource
      ? this.options.normalizeSource(image)
      : defaultNormalizeSource(image, this.options.textureWidth, this.options.textureHeight)
    const layer = this.nextLayer

    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.texture)
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 1)
    this.gl.texSubImage3D(
      this.gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      this.options.textureWidth,
      this.options.textureHeight,
      1,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      normalized,
    )
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 0)
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, null)

    this.indices.set(textureId, layer)
    this.nextLayer += 1
    return layer
  }

  public getTextureIndex(textureId: string): number | null {
    return this.indices.get(textureId) ?? null
  }

  public getTexture(): WebGLTexture {
    return this.texture
  }

  public dispose() {
    this.gl.deleteTexture(this.texture)
    this.indices.clear()
    this.nextLayer = 0
  }
}
