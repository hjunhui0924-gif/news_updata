import type { FeedItem } from '@/shared/types';
import { Markdown } from './markdown';
import { bilingualTree } from '@/shared/bilingual';

export function BilingualTranslation({ item }: { item: FeedItem }) {
  const blocks = item.translationBlocks?.length
    ? item.translationBlocks
    : [{ original: item.body, translation: item.translation }];
  return (
    <div className="bilingual-reader">
      {!item.translationBlocks?.length && <p className="helper">此历史译文按全文对照显示。</p>}
      {blocks.map((block, index) => (
        <section className="bilingual-block" key={index} aria-label={`对照段落 ${index + 1}`}>
          {item.translationBlocks?.length && block.translation !== null ? (
            <Markdown
              text={block.original}
              tree={bilingualTree(block.original, block.translation)}
            />
          ) : (
            <>
              <Markdown text={block.original} />
              {block.translation !== null && (
                <div lang="zh-CN">
                  <Markdown text={block.translation} />
                </div>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
