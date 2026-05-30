import { EntityTextureArray } from '../EntityTextureArray'

const CHARACTER_SKIN_WIDTH = 64
const CHARACTER_SKIN_HEIGHT = 64
const CHARACTER_SKIN_ARRAY_CAPACITY = 256

function createSkinCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = CHARACTER_SKIN_WIDTH
  canvas.height = CHARACTER_SKIN_HEIGHT
  return canvas
}

function copyMirroredRegion(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
) {
  context.save()
  context.translate(dx + sw, dy)
  context.scale(-1, 1)
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
  context.restore()
}

function normalizeCharacterSkin(source: CanvasImageSource & { width: number; height: number }) {
  const canvas = createSkinCanvas()
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to create character skin normalization canvas')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)

  if (source.width === CHARACTER_SKIN_WIDTH && source.height === CHARACTER_SKIN_HEIGHT) {
    context.drawImage(source, 0, 0, CHARACTER_SKIN_WIDTH, CHARACTER_SKIN_HEIGHT)
    return canvas
  }

  if (source.width === CHARACTER_SKIN_WIDTH && source.height === CHARACTER_SKIN_HEIGHT / 2) {
    context.drawImage(source, 0, 0, CHARACTER_SKIN_WIDTH, CHARACTER_SKIN_HEIGHT / 2)
    copyMirroredRegion(context, canvas, 40, 16, 16, 16, 32, 48)
    copyMirroredRegion(context, canvas, 0, 16, 16, 16, 16, 48)
    return canvas
  }

  context.drawImage(source, 0, 0, CHARACTER_SKIN_WIDTH, CHARACTER_SKIN_HEIGHT)
  return canvas
}

export class CharacterSkinTextureArray {
  private readonly textureArray: EntityTextureArray

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.textureArray = new EntityTextureArray(gl, {
      textureWidth: CHARACTER_SKIN_WIDTH,
      textureHeight: CHARACTER_SKIN_HEIGHT,
      capacity: CHARACTER_SKIN_ARRAY_CAPACITY,
      label: 'character skin',
      normalizeSource: normalizeCharacterSkin,
    })
  }

  public async ensureSkin(skinId: string, url: string): Promise<number> {
    return this.textureArray.ensureTexture(skinId, url)
  }

  public getSkinIndex(skinId: string): number | null {
    return this.textureArray.getTextureIndex(skinId)
  }

  public getTexture(): WebGLTexture {
    return this.textureArray.getTexture()
  }

  public dispose() {
    this.textureArray.dispose()
  }
}
