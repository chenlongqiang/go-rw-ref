import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessAccessKind } from '../../heuristic';

function kindOf(line: string, name: string, occurrence = 0): string {
  let start = -1;
  for (let i = 0; i <= occurrence; i++) {
    start = line.indexOf(name, start + 1);
  }
  assert.ok(start >= 0, `未找到 ${name}`);
  return guessAccessKind(line, start, name);
}

test('结构体字面量字段初始化判定为写入', () => {
  assert.equal(kindOf('\t\t\tItems:      makeItems(source, options),', 'Items'), 'write');
  assert.equal(kindOf('\t\tItems: makeItems(source.', 'Items'), 'write');
  assert.equal(kindOf('\t\tItems:      values,', 'Items'), 'write');
  assert.equal(kindOf('\t\tName:  cfg.Name,', 'Name'), 'write');
  assert.equal(kindOf('items := []Content{{Items: []string{"a"}}}', 'Items'), 'write');
  assert.equal(kindOf('x := T{Name: "a", Items: d}', 'Items'), 'write');
  assert.equal(kindOf('x := map[string]T{"k": {Items: d}}', 'Items'), 'write');
  assert.equal(kindOf('\t\tItems: makeItems(', 'Items'), 'write');
});

test('各类赋值与自增判定为写入', () => {
  assert.equal(kindOf('bag[0].Items = []string{}', 'Items'), 'write');
  assert.equal(kindOf('c.Items = src.Values', 'Items'), 'write');
  assert.equal(kindOf('n := len(c.Items)', 'n'), 'write');
  assert.equal(kindOf('n++', 'n'), 'write');
  assert.equal(kindOf('total += size', 'total'), 'write');
  assert.equal(kindOf('mask &^= flag', 'mask'), 'write');
  assert.equal(kindOf('a, b = b, a', 'a'), 'write');
  assert.equal(kindOf('for k, v := range m {', 'k'), 'write');
  assert.equal(kindOf('for _, item := range src.Items {', 'item'), 'write');
  assert.equal(kindOf('c.Items =', 'Items'), 'write');
});

test('读取场景不误判为写入', () => {
  assert.equal(kindOf('c.Items = append(c.Items, "extra")', 'Items', 1), 'read');
  assert.equal(kindOf('if len(c.Items) == 0 {', 'Items'), 'read');
  assert.equal(kindOf('if n == 0 {', 'n'), 'read');
  assert.equal(kindOf('if n <= 0 || n != 1 {', 'n'), 'read');
  assert.equal(kindOf('return c.Items[0]', 'Items'), 'read');
  assert.equal(kindOf('x := s[lo:hi]', 'lo'), 'read');
  assert.equal(kindOf('case Items:', 'Items'), 'read');
  assert.equal(kindOf('case A, Items:', 'Items'), 'read');
  assert.equal(kindOf('foo(&value)', 'value'), 'read');
  assert.equal(kindOf('sort.Strings(cfg.Items)', 'Items'), 'read');
  assert.equal(kindOf('build(ctx, cfg, src.Items, opts)', 'Items'), 'read');
  assert.equal(kindOf('for _, d := range src.Items {', 'Items'), 'read');
  assert.equal(kindOf('Build([]string{"a"})', 'Build'), 'read');
  assert.equal(kindOf('func Build(input []string) *Content {', 'Build'), 'read');
  assert.equal(kindOf('Items []string `json:"items"`', 'Items'), 'read');
});

test('容易混淆的场景：注释、解引用赋值、map 键、goto 标签', () => {
  assert.equal(kindOf('// Items: 这里是注释', 'Items'), 'read');
  assert.equal(kindOf('*p = v', 'p'), 'read');
  assert.equal(kindOf('m := map[string]int{Items: 1}', 'Items'), 'read');
  assert.equal(kindOf('Items:', 'Items'), 'read');
  assert.equal(kindOf('bag.Children[0].Items = nil', 'Children'), 'read');
});

test('返回值永远只有 read 或 write，不存在第三类', () => {
  const lines = [
    'c.Items = append(c.Items, "x")',
    'Items: input,',
    'return c.Items',
    'func Build(x []string) {}',
    '// Items: comment',
  ];
  for (const line of lines) {
    const start = line.indexOf('Items') >= 0 ? line.indexOf('Items') : line.indexOf('Build');
    const name = line.indexOf('Items') >= 0 ? 'Items' : 'Build';
    assert.ok(['read', 'write'].includes(guessAccessKind(line, start, name)));
  }
});
