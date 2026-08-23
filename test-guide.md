# 纯函数输出 JSON 自测脚本模板

适用于"被测函数返回的对象会拼进 JSON，由前端/调用方按特定键名消费"的场景：
- 字段重命名（如 `l2dwAlphaFilter` → `alpha`）
- 字段新增 / 删除
- 默认值过滤（默认态输出空对象）

## 用法

1. 复制下方骨架到 `frontend/scripts/_verify_<本次代号>.ts`（路径相对 `frontend/scripts/`，因此被测模块用 `../src/...` 引用）
2. 替换所有 `__TODO__` 占位
3. 执行 `cd frontend && npx tsx scripts/_verify_<本次代号>.ts`
4. 验证通过后删除该脚本

## 骨架

```typescript
// 临时自测：断言 __被测函数__ 的输出 JSON 行为。
// 复制被测函数实现，避免拖入 Vue / Pixi / Pinia 等运行时。

// TODO: 引入被测函数依赖的常量 / 类型
// import { __常量A__, __常量B__ } from '../src/__被测模块__'

// TODO: 按需定义状态类型
// type __StateType__ = Record<string, number>

// TODO: 复制被测纯函数（与源文件实现保持完全一致）
function __被测函数__(state: __StateType__): Partial<__StateType__> {
  const out: Partial<__StateType__> = {}
  // TODO: 填充函数体
  return out
}

// TODO: 复制最终 JSON 组装函数（与源文件保持一致）
function __buildJson__(/* TODO: 参数 */) {
  return { /* TODO: 返回结构 */ }
}

// ============ 测试用例 ============
let passed = 0
let failed = 0
function check(label: string, cond: boolean, info: any = '') {
  if (cond) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`, info)
    failed++
  }
}

// ---------- 场景 A：被关注字段取非默认值 ----------
const stateA: __StateType__ = { /* TODO: 默认值 + 被关注字段 = 非默认 */ }
const resultA = __被测函数__(stateA)
const jsonA = JSON.stringify(__buildJson__(/* TODO: 参数 */, resultA))

console.log(`\n[Scenario A] 非默认值断言字段名`)
console.log('  JSON:', jsonA)

check('result 不含旧键名', !('__旧键名__' in resultA), { result: resultA })
check(`result["__新键名__"] === __期望值__`, resultA['__新键名__'] === __期望值__, {
  actual: resultA['__新键名__'],
})
check(
  `JSON 字符串含 "__新键名__":__期望值__`,
  jsonA.includes('"__新键名__":__期望值__'),
  { json: jsonA },
)

// ---------- 场景 B：默认态应输出空对象 ----------
const stateB: __StateType__ = { /* TODO: 全默认 */ }
const resultB = __被测函数__(stateB)

console.log(`\n[Scenario B] 默认态输出空对象`)

check(
  '默认态 result 应为空对象',
  Object.keys(resultB).length === 0,
  { result: resultB },
)

// ---------- 场景 C：字段之间互不污染（可选） ----------
// 仅当需要验证"设置其它非默认字段时，被关注字段保持默认不出现在输出中"。
// const stateC: __StateType__ = { /* TODO: 设置另一字段为非默认，被关注字段保持默认 */ }
// const resultC = __被测函数__(stateC)
//
// console.log(`\n[Scenario C] 字段之间互不污染`)
// check('仅其它字段非默认时，被关注字段不应出现在 result 中', !('__新键名__' in resultC), { result: resultC })

// ============ 结果汇总 ============
console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`)
process.exit(failed === 0 ? 0 : 1)
```

## 关键占位清单

| 占位 | 含义 | 示例 |
| --- | --- | --- |
| `__被测函数__` | 被测纯函数名 | `pickNonDefaultFilters` |
| `__被测模块__` | 被测模块路径（相对 `frontend/`） | `live2d/L2dwContainer` |
| `__StateType__` | 状态类型 | `FilterState` |
| `__buildJson__` | 最终 JSON 组装函数名 | `buildTransformData` |
| `__旧键名__` | 改名前的键名（仅重命名场景） | `l2dwAlphaFilter` |
| `__新键名__` | 改名后的键名 | `alpha` |
| `__期望值__` | 场景 A 中被关注字段的期望值 | `0.5` |

## 预期输出

```
[Scenario A] 非默认值断言字段名
  JSON: {...,"__新键名__":__期望值__...}
  ✓ result 不含旧键名
  ✓ result["__新键名__"] === __期望值__
  ✓ JSON 字符串含 "__新键名__":__期望值__

[Scenario B] 默认态输出空对象
  ✓ 默认态 result 应为空对象

=== Result: 4 passed, 0 failed ===
```

退出码 `0`。

## 清理

```bash
rm frontend/scripts/_verify_<本次代号>.ts
```