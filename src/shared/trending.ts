export const trendingLanguages = [
  { value: '', label: '全部语言' },
  { value: 'python', label: 'Python' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'c++', label: 'C++' },
  { value: 'c#', label: 'C#' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
] as const;

export type TrendingRepository = {
  name: string;
  url: string;
  rank: number;
  description: string;
  language: string | null;
  stars: number | null;
  starsToday: number | null;
  chineseDescription?: string | null;
};
export type TrendingSnapshot = {
  repositories: TrendingRepository[];
  fetchedAt: string | null;
  sourceUrl: string;
  language: string;
  stale: boolean;
  error: string | null;
  retryAt: string | null;
};
