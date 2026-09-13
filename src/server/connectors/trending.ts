import { load } from 'cheerio';
import { GitHubError } from './github';
import { trendingLanguages, type TrendingRepository } from '@/shared/trending';

export function trendingUrl(language = '') {
  if (!trendingLanguages.some((x) => x.value === language))
    throw new GitHubError('暂不支持此编程语言筛选。', 400);
  return `https://github.com/trending${language ? '/' + encodeURIComponent(language) : ''}?since=daily`;
}

export function parseTrending(html: string): TrendingRepository[] {
  const $ = load(html);
  const cards = $('article.Box-row');
  // A challenge page or changed markup must not replace a previously useful snapshot.
  if (!cards.length) throw new GitHubError('暂时无法读取 Trending 榜单，请稍后重试。');
  const repositories: TrendingRepository[] = [];
  const seen = new Set<string>();
  const count = (text: string) => {
    const normalized = text.trim().replaceAll(',', '');
    return /^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized))
      ? Number(normalized)
      : null;
  };
  cards.each((_, element) => {
    const card = $(element);
    const href = card.find('h2 a').first().attr('href') ?? '';
    if (!/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(href))
      throw new GitHubError('Trending 页面结构已变化，请稍后重试。');
    const name = href.slice(1);
    if (seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const daily = card
      .find('span')
      .filter((_, el) => /^\s*[\d,]+\s+stars today\s*$/.test($(el).text()))
      .first()
      .text()
      .match(/[\d,]+/);
    repositories.push({
      name,
      url: `https://github.com/${name}`,
      rank: repositories.length + 1,
      description: card.find('p').first().text().replace(/\s+/g, ' ').trim().slice(0, 2000),
      language: card.find('[itemprop="programmingLanguage"]').first().text().trim() || null,
      stars: count(
        card
          .find('a')
          .filter((_, el) => $(el).attr('href') === `${href}/stargazers`)
          .first()
          .text(),
      ),
      starsToday: daily ? count(daily[0]) : null,
    });
  });
  if (repositories.length > 100) throw new GitHubError('Trending 榜单格式异常。');
  return repositories;
}

export async function fetchTrending(language: string): Promise<TrendingRepository[]> {
  const response = await fetch(trendingUrl(language), {
    headers: { Accept: 'text/html', 'User-Agent': 'Newsroom-MVP/0.1', 'Accept-Language': 'en-US' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) throw new GitHubError('GitHub Trending 暂时不可用，请稍后重试。');
  const html = await response.text();
  if (html.length > 2000000) throw new GitHubError('Trending 页面超出读取范围。');
  return parseTrending(html);
}
