import { ReadTextFile } from '../../wailsjs/go/main/App'
import type { MotionEntry } from '../live2d/coreAdapter'
import { pathCombine, pathDirname } from '../path_utils'
import { motionParser } from './motionImport'

export async function loadModelMotion(modelPath: string, entry: MotionEntry) {
  if (!modelPath || !entry.path) throw new Error('没有可用的文件路径')
  const path = pathCombine(pathDirname(modelPath), entry.path)
  const parse = motionParser(path)
  return parse(await ReadTextFile(path), entry.name)
}
