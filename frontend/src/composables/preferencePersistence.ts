import { useMessage } from './useMessage'

export function createPreferencePersistence(name: string, readFallback: string, saveFallback: string) {
  let initialized = false
  let changed = false
  let save = Promise.resolve()

  function warn(message: string, fallback: string, error: unknown) {
    console.error(message, error)
    useMessage().warning(`${message}，${fallback}`)
  }

  function loadOnce<T>(read: () => Promise<T>, apply: (value: T) => void) {
    if (initialized) return
    initialized = true
    read().then(value => {
      if (!changed) apply(value)
    }).catch(err => warn(`读取${name}失败`, readFallback, err))
  }

  function commit(apply: () => void, write: () => Promise<void>) {
    changed = true
    apply()
    save = save.then(() => write()).catch(err => warn(`保存${name}失败`, saveFallback, err))
  }

  return { loadOnce, commit }
}
