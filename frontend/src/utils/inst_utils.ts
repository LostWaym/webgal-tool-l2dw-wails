import SceneParser, { ADD_NEXT_ARG_LIST, SCRIPT_CONFIG } from 'webgal-parser/build/es/index.js';
import type { ISentence } from 'webgal-parser/build/types/interface/sceneInterface';

// 虽然引入了 webgal-parser 库，但实际上我们通过 inst_utils.ts 对其进行了封装，所以完全不必去看任何 webgal-parser 相关的内容，只用 inst_utils.ts 里的内容即可。

/** 参数值的允许类型（与 webgal-parser 的 arg.value 对齐） */
export type ArgValue = string | number | boolean;

/** 单条参数：{ key, value } */
export interface InstArg {
  key: string;
  value: ArgValue;
}

/** 指令的纯数据部分 */
export interface InstData {
  commandRaw: string;
  content: string;
  args: InstArg[];
}

/** 挂在 Inst 上的操作方法 */
export interface InstOps {
  getParamValue(key: string): ArgValue | undefined;
  getParamJson<T = unknown>(key: string): T | undefined;
  setParamValue(key: string, value: ArgValue): void;
  /** 同 setParamValue，但 value 必须是 plain object/array，内部 JSON.stringify 存为 string */
  setParamJson(key: string, value: unknown): void;
  removeParam(key: string): boolean;
  isParamExists(key: string): boolean;
  /** 仅序列化 args 部分（形如 `-k=v -flag`），不含 commandRaw/content 与末尾分号 */
  toArgsString(): string;
  toInstString(): string;
}

/** 数据 + 操作的统一类型 */
export type Inst = InstData & InstOps;

const sharedParser = new SceneParser(
  () => {},
  (name: string) => name,
  ADD_NEXT_ARG_LIST,
  SCRIPT_CONFIG,
);

/** 返回一个空参数的 Inst（commandRaw="changeBg"、content=""、args=[]） */
export function createEmptyInst(): Inst {
  return parseInst('changeBg:;');
}

export function parseInst(line: string): Inst {
  const sentence: ISentence = sharedParser.parse(line, 'a', 'a').sentenceList[0];
  const inst: Inst = {
    commandRaw: sentence.commandRaw,
    content: sentence.content,
    args: sentence.args.map((a) => ({
      key: a.key,
      value: typeof a.value === 'string' ? unquote(a.value) : a.value,
    })),
    getParamValue(key) {
      return this.args.find((a) => a.key === key)?.value;
    },
    getParamJson(key) {
      const raw = this.args.find((a) => a.key === key)?.value;
      if (typeof raw !== 'string') return undefined;
      if (!raw.startsWith('{') && !raw.startsWith('[')) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    setParamValue(key, value) {
      this.args = this.args.filter((a) => a.key !== key);
      this.args.push({ key, value });
    },
    setParamJson(key, value) {
      if (value === null || typeof value !== 'object') {
        throw new TypeError(`setParamJson: value must be an object/array, got ${typeof value}`);
      }
      this.setParamValue(key, JSON.stringify(value));
    },
    removeParam(key) {
      const before = this.args.length;
      this.args = this.args.filter((a) => a.key !== key);
      return this.args.length !== before;
    },
    isParamExists(key) {
      return this.args.some((a) => a.key === key);
    },
    toArgsString() {
      return this.args.map(formatArg).join(' ');
    },
    toInstString() {
      return formatInst(this);
    },
  };
  return inst;
}

// webgal-parser 不反转义被双引号包裹的字符串，这里手动剥离外壳并还原转义
function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return raw;
}

function formatInst(inst: Inst): string {
  const head = inst.content ? `${inst.commandRaw}:${inst.content}` : `${inst.commandRaw}:`;
  const tail = inst.toArgsString();
  return tail ? `${head} ${tail};` : `${head};`;
}

function formatArg(a: InstArg): string {
  const v = a.value;
  if (v === true) return `-${a.key}`;
  if (v === false) return `-${a.key}=false`;
  if (typeof v === 'number') return `-${a.key}=${v}`;
  return `-${a.key}=${quoteIfNeeded(v)}`;
}

function quoteIfNeeded(value: string): string {
  // JSON 对象/数组：原文输出，不加引号不转义
  if (value.startsWith('{') || value.startsWith('[')) return value;
  // 必须加引号：包含空格 / 等号 / 分号 / 开头为 `-` / 包含引号本身
  if (/[\s=;"]/.test(value) || value.startsWith('-')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}
