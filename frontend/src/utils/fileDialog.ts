import { useMessage } from '../composables/useMessage'

export async function choosePath(dialog: () => Promise<string>, kind: 'file' | 'directory' = 'file'): Promise<string> {
  let path: string
  try {
    path = await dialog()
  } catch (err) {
    if ((err instanceof Error ? err.message : String(err)).toLowerCase() !== 'shellitem is nil') throw err
    path = ''
  }
  if (!path) useMessage().info(kind === 'file' ? '未选择文件' : '未选择文件夹')
  return path
}

export async function choosePaths(dialog: () => Promise<string[] | null>): Promise<string[]> {
  let paths: string[] | null
  try {
    paths = await dialog()
  } catch (err) {
    if ((err instanceof Error ? err.message : String(err)).toLowerCase() !== 'shellitem is nil') throw err
    paths = null
  }
  if (!paths?.length) useMessage().info('未选择文件')
  return paths ?? []
}
