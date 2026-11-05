import { getItem } from '../db/store';
import { AccessError } from '../auth/errors';
import { getConfig } from '../config';
import { enqueue } from '../jobs/queue';
export async function enqueueAi(userId: string, id: string, kind: 'summary' | 'translation') {
  const item = await getItem(userId, id);
  if (!item) throw new AccessError('更新不存在', 404);
  if (item.type === 'video' && kind === 'summary')
    throw new AccessError('当前仅收录视频简介，不生成视频内容摘要。', 400);
  if (!item.body.trim()) throw new AccessError('来源没有可读取的正文。', 400);
  if (kind === 'translation' && item.translation) return { status: 'completed' };
  if (kind === 'translation' && item.language !== 'zh' && item.body.length > 16000)
    throw new AccessError('正文超过翻译长度上限（16000 字符），请先阅读原文。', 400);
  if (kind === 'summary' && item.summary) return { status: 'completed' };
  if (
    !item.demo &&
    getConfig().LLM_ENABLED !== 'true' &&
    !(kind === 'translation' && item.language === 'zh')
  )
    throw new AccessError('尚未配置 AI 服务，原文可直接阅读。', 400);
  return enqueue(userId, kind, id);
}
