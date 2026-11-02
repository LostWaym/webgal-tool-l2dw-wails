<script setup lang="ts">
import { ref } from 'vue'
import { useModelStore } from '../../../stores/previewStore'
import { choosePreviewProject, savePreviewProject } from '../../../utils/previewProject'
import type { PreviewProject } from '../../../utils/previewProject'
import { useMessage } from '../../../composables/useMessage'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'load', project: PreviewProject, path: string): void }>()
const store = useModelStore()
const msg = useMessage()
const selected = ref<Awaited<ReturnType<typeof choosePreviewProject>>>(null)
const busy = ref(false)

async function save() {
  busy.value = true
  try { if (await savePreviewProject(store)) msg.success('项目已保存') }
  catch (err) { msg.error(`保存项目失败：${String(err)}`) }
  finally { busy.value = false }
}

async function choose() {
  busy.value = true
  try {
    const result = await choosePreviewProject()
    if (result) selected.value = result
  } catch (err) {
    selected.value = null
    msg.error(`读取项目失败：${String(err)}`)
  } finally { busy.value = false }
}

function load() {
  const item = selected.value
  if (!item) return
  const warning = item.missing.length ? `以下资源缺失：\n\n${item.missing.join('\n')}\n\n继续加载可能导致部分内容无法显示，是否继续？` : '加载项目将覆盖当前所有状态，是否继续？'
  if (!window.confirm(warning)) return
  if (item.missing.length && !window.confirm('继续加载将覆盖当前所有状态，是否确认？')) return
  emit('load', item.project, item.path)
  selected.value = null
}

function close() { if (!busy.value) { selected.value = null; emit('close') } }
</script>

<template>
  <Teleport to="body">
    <div v-if="props.visible" class="project-mask" @click.self="close">
      <section class="project-modal">
        <header><h2>预览项目</h2><button class="close" @click="close">×</button></header>
        <div class="body">
          <div class="actions">
            <button :disabled="busy" @click="save">项目另存为…</button>
            <button :disabled="busy" @click="choose">选择要加载的项目…</button>
          </div>
          <template v-if="selected">
            <p class="path">{{ selected.path }}</p>
            <p class="notice">确认加载后，当前所有项目状态将被覆盖。</p>
            <h3>立绘（{{ selected.project.models.length }}）</h3>
            <ul><li v-for="m in selected.project.models" :key="m.id">{{ m.name }} · {{ m.kind === 'image' ? '图片' : 'Live2D' }} · {{ m.source }}</li></ul>
            <h3>立绘组（{{ selected.project.figureGroups.length }}）</h3>
            <ul><li v-for="g in selected.project.figureGroups" :key="g.id">{{ g.name }} · {{ g.targetIds.length }} 个立绘 / {{ g.targetGroupIds.length }} 个嵌套组</li></ul>
            <h3>场景与其他</h3>
            <ul><li>背景：{{ selected.project.background.path || '默认背景' }}</li><li>背景与主场景变换、滤镜及指令模板</li><li>变换快照：{{ selected.project.snapshots.length }} 个</li><li>图片立绘模板及变换模板</li></ul>
            <div v-if="selected.missing.length" class="missing"><strong>缺失资源（{{ selected.missing.length }}）</strong><ul><li v-for="path in selected.missing" :key="path">{{ path }}</li></ul></div>
          </template>
          <p v-else class="empty">选择项目后，可在此查看加载清单。</p>
        </div>
        <footer><button @click="close">取消</button><button class="primary" :disabled="!selected || busy" @click="load">确认加载并覆盖</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.project-mask { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; }
.project-modal { width: min(760px, 94vw); max-height: 85vh; display: flex; flex-direction: column; background: #1d2026; border: 1px solid #454d5a; border-radius: 9px; color: #e6e6e6; box-shadow: 0 12px 40px #0008; }
header, footer { display: flex; align-items: center; gap: 10px; padding: 14px 18px; }
header { border-bottom: 1px solid #373d48; } h2 { flex: 1; margin: 0; font-size: 16px; } h3 { font-size: 14px; margin: 18px 0 6px; }
.body { overflow: auto; padding: 16px 18px; } .actions { display: flex; gap: 10px; } button { border: 1px solid #495464; border-radius: 5px; padding: 8px 13px; color: inherit; background: #303743; cursor: pointer; } button:disabled { opacity: .45; cursor: default; } .primary { background: #2f80ed; border-color: #2f80ed; } .close { border: 0; background: transparent; font-size: 22px; padding: 0 5px; }
footer { justify-content: flex-end; border-top: 1px solid #373d48; } ul { margin: 6px 0; padding-left: 22px; } li, .path { overflow-wrap: anywhere; line-height: 1.6; } .path, .empty { color: #aeb7c5; } .notice, .missing { color: #ffcc80; } .missing { border: 1px solid #805e32; border-radius: 5px; padding: 10px; margin-top: 14px; }
</style>
