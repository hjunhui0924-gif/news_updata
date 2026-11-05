import { z } from 'zod';
import { AccessError } from '../auth/errors';
import { getPool } from '../db/client';
import { resolveAiConfig } from './settings';
import { AiError, createModelCall, reserveBudget, type ModelCall } from './service';

export async function testPersonalAiConnection(
  userId: string,
  revision: number,
  model?: ModelCall,
) {
  const config = await resolveAiConfig(userId, revision);
  if (config.billingScope !== 'personal' || config.LLM_ENABLED !== 'true')
    throw new AccessError('请先保存可用的个人模型配置；密钥无法读取时请重新填写。', 400);
  const reservation =
    (500 * config.LLM_INPUT_USD_PER_MILLION + 64 * config.LLM_OUTPUT_USD_PER_MILLION) / 1000000;
  const id = await reserveBudget(userId, reservation, new Date(), config);
  try {
    const response = await (model ?? createModelCall(config, 10000))({
      system: 'Return JSON {"ok":true}.',
      user: 'Connection test.',
      kind: 'translation',
      outputLimit: 64,
      responseSchema: z.object({ ok: z.literal(true) }).strict(),
      schemaName: 'connection_test',
    });
    const cost =
      response.inputTokens !== undefined && response.outputTokens !== undefined
        ? (response.inputTokens * config.LLM_INPUT_USD_PER_MILLION +
            response.outputTokens * config.LLM_OUTPUT_USD_PER_MILLION) /
          1000000
        : reservation;
    await getPool().query("UPDATE ai_usage SET cost=$2,status='settled' WHERE id=$1", [id, cost]);
    z.object({ ok: z.literal(true) }).parse(response.value);
    return { ok: true, message: '连接成功，模型支持当前接口格式。' };
  } catch (error) {
    await getPool().query(
      "UPDATE ai_usage SET status='uncertain' WHERE id=$1 AND status='reserved'",
      [id],
    );
    throw new AccessError(
      error instanceof AiError ? error.message : '连接测试未完成，请检查服务、模型与密钥后重试。',
      400,
    );
  }
}
