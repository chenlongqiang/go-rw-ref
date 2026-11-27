/**
 * gopls 未给出明确读写类型（返回 Text / 无结果）时使用的语法判定。
 * 只看单行文本，不依赖 VS Code API，便于直接做单元测试。
 *
 * 目标：每一处引用都必须落到 read 或 write，绝不产生「无法分类」的第三类。
 */
export type HeuristicKind = 'write' | 'read';

const ASSIGN_AFTER = /^\s*(?::=|=(?!=)|(?:<<|>>|&\^|[-+*/%&|^])=)/;
const INC_DEC_AFTER = /^\s*(?:\+\+|--)/;
// a, b = ... / k, v := range ...，当前符号位于左侧标识符列表中。
const LHS_LIST_TAIL =
  /^\s*,\s*[A-Za-z_][\w.]*(?:\[[^\]]*\])*(?:\s*,\s*[A-Za-z_][\w.]*(?:\[[^\]]*\])*)*\s*(?::=|=(?!=))/;
// 结构体字面量键：Name: value（排除 := ）。
const COLON_AFTER = /^\s*:(?!=)/;
const COMPOSITE_KEY_BEFORE = /(?:^|[{,])\s*$/;
const CASE_LABEL_BEFORE = /\b(?:case|default)\b/;
// map[K]V{Key: v} 中 Key 是变量键，是被读取而非字段写入。
const MAP_LITERAL_BEFORE = /map\s*\[[^\]]*\][^{]*\{\s*$/;
// 注释中的同名文字不是代码引用。
const COMMENT_BEFORE = /\/\//;
// *p = v 改的是 p 指向的值，p 本身只是被读取。
const DEREF_BEFORE = /\*\s*$/;
// 独立一行的 goto / break 标签。
const LABEL_LINE = /^\s*[A-Za-z_]\w*:\s*(?:\/\/.*)?$/;

export function guessAccessKind(lineText: string, start: number, name: string): HeuristicKind {
  const before = lineText.slice(0, start);
  const after = lineText.slice(start + name.length);

  if (COMMENT_BEFORE.test(before)) {
    return 'read';
  }
  if (DEREF_BEFORE.test(before)) {
    return 'read';
  }
  if (INC_DEC_AFTER.test(after) || ASSIGN_AFTER.test(after) || LHS_LIST_TAIL.test(after)) {
    return 'write';
  }
  if (COLON_AFTER.test(after) && COMPOSITE_KEY_BEFORE.test(before) && !CASE_LABEL_BEFORE.test(before)) {
    if (MAP_LITERAL_BEFORE.test(before) || LABEL_LINE.test(lineText)) {
      return 'read';
    }
    return 'write';
  }
  return 'read';
}
