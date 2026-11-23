import { PickPreviewGuidesFile, ReadTextFile, SavePreviewGuidesFileDialog, WriteTextFile } from '../../wailsjs/go/main/App'
import { choosePath } from './fileDialog'
import { isPreviewGuide, type PreviewGuide } from './previewGuides'

const guideFileHeader = { format: 'l2dw-guides', version: 1 } as const

export async function exportPreviewGuides(guides: readonly PreviewGuide[]): Promise<boolean> {
  const path = await choosePath(SavePreviewGuidesFileDialog, 'file', { silentOnCancel: true })
  if (!path) return false
  await WriteTextFile(path, JSON.stringify({ ...guideFileHeader, guides }, null, 2))
  return true
}

export async function choosePreviewGuides(): Promise<PreviewGuide[] | null> {
  const path = await choosePath(PickPreviewGuidesFile, 'file', { silentOnCancel: true })
  if (!path) return null
  const parsed: unknown = JSON.parse(await ReadTextFile(path))
  if (!parsed || typeof parsed !== 'object') throw new Error('不是有效的游标文件')
  const { format, version, guides } = parsed as Record<string, unknown>
  if (format !== guideFileHeader.format || version !== guideFileHeader.version || !Array.isArray(guides)) {
    throw new Error('游标文件格式无效或版本不受支持')
  }
  return guides.map((guide: unknown, index): PreviewGuide => {
    if (!isPreviewGuide(guide)) throw new Error(`第 ${index + 1} 条游标的轴向或坐标无效`)
    return { axis: guide.axis, position: guide.position }
  })
}
