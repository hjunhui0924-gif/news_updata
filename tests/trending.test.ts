import { expect, it } from 'vitest';
import { parseTrending, trendingUrl } from '../src/server/connectors/trending';

function card(name: string, extra = '') {
  return `<article class="Box-row"><h2><a href="/${name}">Ignored label</a></h2><p>A &amp; B &lt;script&gt;example&lt;/script&gt;</p>${extra}</article>`;
}
it('reads source order, decoded plain text, language and daily growth without mistaking total stars', () => {
  const result = parseTrending(
    card(
      'owner/first',
      '<span itemprop="programmingLanguage">C++</span><a href="/owner/first/stargazers">12,300</a><span><svg></svg> 1,045 stars today </span>',
    ) +
      card('owner/second') +
      card('OWNER/FIRST'),
  );
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({
    name: 'owner/first',
    rank: 1,
    url: 'https://github.com/owner/first',
    description: 'A & B <script>example</script>',
    language: 'C++',
    stars: 12300,
    starsToday: 1045,
  });
  expect(result[1]).toMatchObject({ rank: 2, stars: null, starsToday: null, language: null });
});
it('rejects challenge markup and invalid repository links instead of caching empty success', () => {
  for (const html of [
    '<html>Verify you are human</html>',
    card('/evil.example/repo'),
    card('owner/repo?token=secret'),
  ])
    expect(() => parseTrending(html)).toThrow();
});
it('allowlists language URLs including encoded punctuation', () => {
  expect(trendingUrl('c++')).toBe('https://github.com/trending/c%2B%2B?since=daily');
  expect(trendingUrl('c#')).toBe('https://github.com/trending/c%23?since=daily');
  expect(() => trendingUrl('../login')).toThrow();
});
