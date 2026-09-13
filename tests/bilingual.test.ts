import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { load } from 'cheerio';
import { bilingualTree } from '../src/shared/bilingual';

function render(original: string, translated: string) {
  return load(
    renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        {
          remarkPlugins: [() => () => bilingualTree(original, translated)],
          skipHtml: true,
        },
        original,
      ),
    ),
  );
}
it('renders each original and translation within one list item, keeping source heading and links', () => {
  const $ = render(
    '### Improvements\n\n- Default image requests. [#101](https://github.com/example/repo/issues/101)\n- Refresh image guidance.',
    '### 改进\n\n- 默认图片请求。 [#101](https://github.com/example/repo/issues/101)\n- 更新图片指引。',
  );
  expect($('h3').text()).toBe('Improvements');
  expect($('ul')).toHaveLength(1);
  expect($('li')).toHaveLength(2);
  expect(
    $('li')
      .first()
      .children('p')
      .map((_, el) => $(el).text())
      .get(),
  ).toEqual(['Default image requests. #101', '默认图片请求。 #101']);
  expect($('li').first().children('p').last().attr('lang')).toBe('zh-CN');
  expect($('a')).toHaveLength(2);
  expect(
    $('a')
      .map((_, el) => $(el).attr('href'))
      .get(),
  ).toEqual(Array(2).fill('https://github.com/example/repo/issues/101'));
});
it('retains ordered list start, nested items, inline code and fenced code without duplicate markers', () => {
  const $ = render(
    '3. First `command`.\n\n   - Nested detail.\n\n4. Second step.\n\n```js\nconsole.log(1)\n```',
    '3. 第一个 `command`。\n\n   - 嵌套说明。\n\n4. 第二步。\n\n```js\nconsole.log(1)\n```',
  );
  expect($('ol').attr('start')).toBe('3');
  expect($('ol > li')).toHaveLength(2);
  expect($('ul > li')).toHaveLength(1);
  expect($('ul > li p')).toHaveLength(2);
  expect($('pre')).toHaveLength(1);
  expect($('code').first().text()).toBe('command');
});
it('keeps original and translated reference links resolving to their respective definitions', () => {
  const $ = render(
    'Read the [guide][docs].\n\n> [docs]: https://example.com/en',
    '阅读[指南][docs]。\n\n> [docs]: https://example.com/zh',
  );
  expect(
    $('a')
      .map((_, el) => $(el).attr('href'))
      .get(),
  ).toEqual(['https://example.com/en', 'https://example.com/zh']);
});
it('preserves full blocks on unequal list shapes instead of misaligning entries', () => {
  const $ = render('- First step.\n- Second step.', '- 第一步。\n- 新增项目。\n- 第二步。');
  expect($('ul')).toHaveLength(2);
  expect($('ul').first().children()).toHaveLength(2);
  expect($('ul').last().children()).toHaveLength(3);
});
