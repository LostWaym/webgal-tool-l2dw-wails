# Live2D 动作文件格式参考（.mtn / motion3.json）

本文档记录 Cubism 2 `.mtn` 与 Cubism 3+ `.motion3.json` 的结构参考，以及本项目 lanim 的导出映射和未来导入设想。用于动作格式、导入 / 导出开发参考。

## 维护规范

- 涉及动作格式、导入导出或 lanim 映射时按需阅读；编辑器入口与交互见 [MOTION_DOC.md](MOTION_DOC.md)。
- 格式参考、已实现行为和未来设想应明确区分；项目当前行为以代码为准。
- 修改序列化或导出行为时同步检查映射说明；有依据地修订或移除失效描述，不把推测当作格式保证。

参考样例文件：

- `.mtn`：`extres/game2/figure/anon/037_casual-2023_rip/live2d/chara/037_general_rip/idle01.mtn`
- `.motion3.json`：`extres/game2/figure/on/mutsumi/adv_live2d_mutsumi_007_casual_spring_01/.mtn_exp/motions/mutsumi/mtn_idle01_C.motion3.json`

导出实现：`frontend/src/utils/motionExport.ts`
MTN 导入实现：`frontend/src/utils/motionImport.ts`，按采样逐帧建立 lanim 参数轨道；反烘焙由用户单独执行，不保留 fade 元数据。

---

## 一、Cubism 2 `.mtn`（Live2D Animator Motion Data）

### 1. 文件整体结构

```
# Live2D Animator Motion Data     ← 魔数注释行（固定文本）
$fps=30                           ← 采样帧率

$fadein=0                         ← 全局淡入（毫秒）

$fadeout=1000                     ← 全局淡出（毫秒）

$fadeout:PARAM_EYE_R_OPEN=500     ← 逐参数淡出（毫秒），可出现多行，也可能零行
...

PARAM_ANGLE_X=0,0.002,0.006,...   ← 参数曲线：参数ID=逗号分隔的值序列
PARAM_ANGLE_Y=-16.08,...
PARAM_EYE_R_SMILE=0               ← 常量参数：只有一个值（整条动画恒定）
```

### 2. 语法逐项说明

| 元素 | 含义 |
| --- | --- |
| `# Live2D Animator Motion Data` | 文件标识行，解析时可作校验 |
| `$fps=<n>` | 每秒采样帧数。**帧间隔 = 1/fps 秒**，值序列第 i 个值对应时间 `i / fps` |
| `$fadein=<ms>` / `$fadeout=<ms>` | 全局淡入/淡出时长（毫秒），缺省可视为 0 / 1000 |
| `$fadeout:<PARAM_ID>=<ms>` | 该参数单独的淡出时长；`$fadein:<PARAM_ID>=<ms>` 同理。注意 `:` 与 `=` 分隔混用（`$fadeout=1000` 是全局、`$fadeout:PARAM_X=500` 是逐参），解析需兼容两种写法 |
| `PARAM_XXX=v0,v1,v2,...` | 一条参数曲线。**值的个数 = 采样帧数**，`v[i]` 为 `t = i/fps` 时刻的参数值 |

### 3. 关键特征

- **没有 segment / 插值类型标记**：`.mtn` 是逐帧采样格式，值之间为线性插值（或由 runtime 决定），不存在贝塞尔/stepped 描述。
- 没有独立时刻列，时间轴完全由下标 × (1/fps) 隐含。
- 常量参数只写一个值（如 `PARAM_EYE_R_SMILE=0`），等价于整条动画水平线。
- 动作总时长 = `(值个数 - 1) / fps`（样例约 184 值 / 30fps ≈ 6s）。
- 导出时应保留所有参数行（含恒定值参数），每行对应 motion3.json 中一个 Curve。

---

## 二、Cubism 3+ `.motion3.json`

### 1. 顶层结构

```json
{
  "Version": 3,
  "Meta": { ... },
  "Curves": [ ... ]
}
```

### 2. Meta 对象（实际样例值）

```json
"Meta": {
  "Duration": 6.0,              // 总时长（秒）
  "Fps": 30.0,                  // 帧率（仅参考，真实时间轴在 Segments 里）
  "Loop": true,                 // 是否循环
  "AreBeziersRestricted": true, // 贝塞尔控制点是否被约束（控制点 x 固定在两端点 1/3、2/3 处）
  "FadeInTime": 1.0,            // 全局淡入（秒）
  "FadeOutTime": 1.0,           // 全局淡出（秒）
  "CurveCount": 67,             // Curves 数组长度
  "TotalSegmentCount": 86,      // 所有 curve 的 segment 总数
  "TotalPointCount": 153,       // 所有曲线关键点总数（含每条 curve 的首点）
  "UserDataCount": 0,           // UserData 数组长度（本文件无 UserData）
  "TotalUserDataSize": 0
}
```

### 3. Curves 数组每项

```json
{
  "Target": "Parameter",       // "Parameter" | "PartOpacity"（部件透明度） | "Model"（模型整体 Opacity）
  "Id": "ParamAngleX",         // 参数 ID（Cubism2 导出时通常为旧 ID，需按模型映射表换成 moc3 的 ID）
  "FadeInTime": -1.0,          // -1 表示未单独设置，回落到 Meta.FadeInTime
  "FadeOutTime": -1.0,
  "Segments": [ 0.0, 0.12, 0.0, 2.067, -0.18, 0.0, 4.133, -0.438, 0.0, 6.0, 0.12 ]
}
```

### 4. Segments 编码格式（核心）

1. 开头两个数 = 首个关键点 `(x0, y0)`，x 为时间（秒），y 为参数值。
2. 之后循环：`[segmentType, ...该段的点数据...]`。

| 值 | 类型 | 点数据 | 含义 |
| --- | --- | --- | --- |
| `0` | 线性 Linear | `(x1, y1)` 共 1 个点 | 从上一端点到该点直线插值 |
| `1` | 三次贝塞尔 Bezier | `(cx1, cy1), (cx2, cy2), (x1, y1)` 共 3 个点 | 两个控制点 + 终点 |
| `2` | Stepped | `(x1, y1)` 共 1 个点 | 保持上一端点值直到 x1，然后跳变到 y1（阶跃） |
| `3` | InverseStepped | `(x1, y1)` 共 1 个点 | 先立即跳到 y1，保持到 x1（先变后等） |

点计数：`Meta.TotalPointCount` = 每条曲线的 `(1 + 段类型点数总和)` 之和；`TotalSegmentCount` = 各曲线段数之和。

样例解读：

```json
"Segments": [0.0, -0.42,  0.0, 2.933, -1.02,  0.0, 6.0, -0.42]
//           └首点(0,-0.42) └type0线性→(2.933,-1.02) └type0线性→(6.0,-0.42)
// 2 段线性、3 个关键点
```

贝塞尔（type 1）形状：

```json
"Segments": [0,0,  1, 0.5,0.2, 1.0,0.5, 1.5,1.0,  0, 3.0,0.0]
//           首点   type1: ctrl1(0.5,0.2) ctrl2(1.0,0.5) 终点(1.5,1.0)   type0: 直线到(3,0)
```

若 `AreBeziersRestricted=true`，则约定 `cx1.x = x0 + (x1-x0)/3`、`cx2.x = x0 + 2*(x1-x0)/3`，导出只需决定控制点的 y。

---

## 三、lanim 与两种格式的映射（本项目导出规则）

lanim（`.lanim.json`）为帧制：`fps` / `durationFrames` / `tracks`（每 track = `paramId` + 按 frame 升序的 keys）。插值方式和采样函数 `sampleTrack` 以 `frontend/src/stores/motionEditor.ts` 为准。

### lanim → .mtn

1. 首行标识 `# Live2D Animator Motion Data`，随后 `$fps=<lanim.fps>` 和 `$fadein` / `$fadeout`（模态内可编辑）。
2. 每条轨道用 `sampleTrack` 逐帧采样至末关键帧，格式化后裁剪尾部连续重复值，仅保留第一个。
3. 将裁剪后最长的一条轨道延伸至 `durationFrames`，以保留动作时长；其他全帧同值轨道只输出单值。各轨道以逗号拼接为 `PARAM_ID=...`。

### lanim → motion3.json

1. 每条轨道一个 Curve：`Target="Parameter"`，逐帧采样生成线性段（帧 0..末关键帧帧号，尾部裁剪）——首点 `(0, v0)`，每帧追加 `0, i/fps, v[i]`（type 0）；常量参数补 1 段线性延伸到 `Meta.Duration`（值恒定，视觉等价；0 段会导致 runtime parse 越界写 segments）。`Meta.Duration` 仍为全局 `durationFrames/fps`，不随单轨道缩短。
2. `Meta`：`Duration = durationFrames/fps`、`Fps`、`Loop: true`、`AreBeziersRestricted: true`、`FadeInTime/FadeOutTime`（模态内 ms 输入 ÷ 1000）、`CurveCount / TotalSegmentCount / TotalPointCount` 实算，UserData 置 0。
3. `Version` 固定 `3`；`minify` 选项控制是否单行 JSON。

### .mtn → motion3.json（未来若做导入可参考）

1. 头部映射：`$fps` → `Meta.Fps`；最长参数曲线长度算出 `Meta.Duration`；`$fadein/$fadeout`(ms) → `Meta.FadeInTime/FadeOutTime`(s)；逐参 fadeout → 各 Curve 的 `FadeInTime/FadeOutTime`(s，未设则 -1)。
2. 每个 `PARAM_X=v0,v1,...` 生成一个 Curve：`Target="Parameter"`（若该 ID 映射到部件透明度则用 `PartOpacity`），`Id` 按参数映射表转换。
3. 值序列转 Segments：首点 `(0, v0)`，每帧追加 `0, i/fps, v[i]`（type 0）。若需压缩体积，共线连续点可合并成一段线性（同时更新 TotalSegmentCount/TotalPointCount）。
4. 常量参数仍导出一条 Curve：`Segments=[0, v, 0, Duration, v]`（补 1 段延伸到 Duration，避免 runtime parse 越界），建议保留以维持参数表完整性。
5. `Loop` 应根据动作内容或用户选择决定；逐帧采样本身不能保证首尾无缝。`AreBeziersRestricted` 可按输出的曲线类型确定；无 UserData 时相关计数置 0。

### ID 体系注意事项

- Cubism 2 模型参数 ID 为 `PARAM_ANGLE_X` 风格；Cubism 3+ 为 `ParamAngleX` 风格。两者之间需要模型映射表转换。
- 本项目导出时直接使用 lanim 轨道里的 `paramId` 原文。若轨道来自 moc3 模型（`ParamAngleX` 风格），导出的 `.mtn` 也是这套 ID——喂给 Cubism 2 模型前需确保轨道参数是该模型的实际 ID。
