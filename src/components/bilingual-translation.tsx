import type { FeedItem } from '@/shared/types';
import { Markdown } from './markdown';

export function BilingualTranslation({ item }: { item: FeedItem }) {
  const blocks = item.translationBlocks?.length
    ? item.translationBlocks
    : [{ original: item.body, translation: item.translation }];
  return (
    <div className="bilingual-reader">
      <p className="helper">
        原文在上，中文在下。{!item.translationBlocks?.length && '此历史译文按全文对照显示。'}
      </p>
      {blocks.map((block, index) => (
        <section className="bilingual-block" key={index} aria-label={`对照段落 ${index + 1}`}>
          <div className="bilingual-original">
            <span className="bilingual-label">
              原文{block.translation === null ? ' · 保留内容' : ''}
            </span>
            <Markdown text={block.original} />
          </div>
          {block.translation !== null && (
            <div className="bilingual-chinese" lang="zh-CN">
              <span className="bilingual-label">中文</span>
              <Markdown text={block.translation} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
