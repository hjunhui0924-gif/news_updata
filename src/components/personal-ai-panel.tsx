'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
} from 'lucide-react';
import type { PersonalAiInput, PersonalAiSettings, AiMode } from '@/shared/ai-settings';
import { Button } from './ui/button';
import { requestJson } from './request-json';
import { PersonalSettingsNav } from './personal-settings-nav';

function draft(settings: PersonalAiSettings): PersonalAiInput {
  const { mode, revision, baseUrl, model, inputPrice, outputPrice, dailyBudget, monthlyBudget } =
    settings;
  return { mode, revision, baseUrl, model, inputPrice, outputPrice, dailyBudget, monthlyBudget };
}
export function PersonalAiPanel({
  demo,
  navigate,
  onChanged,
}: {
  demo: boolean;
  navigate: (view: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [saved, setSaved] = useState<PersonalAiSettings | null>(null);
  const [form, setForm] = useState<PersonalAiInput | null>(null);
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [reload, setReload] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    requestJson<PersonalAiSettings>('/api/settings/ai', 'GET', undefined, abort.signal)
      .then((value) => {
        if (abort.signal.aborted) return;
        setSaved(value);
        setForm(draft(value));
        setKey('');
        setLoading(false);
        setError('');
        setResult('');
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          setError((error as Error).message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [reload]);
  const dirty =
    !!form && !!saved && (JSON.stringify(form) !== JSON.stringify(draft(saved)) || !!key);
  const pending = !!busy;
  useEffect(() => {
    if (!dirty && !pending) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const leave = (event: Event) => {
      const message = pending
        ? '操作仍在处理中，离开后已发送的请求可能继续执行。是否离开？'
        : '个人 AI 配置有未保存修改，是否放弃修改并离开？';
      if (!window.confirm(message)) event.preventDefault();
    };
    const confirmed = () => window.removeEventListener('beforeunload', unload);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('newsroom:navigate', leave);
    window.addEventListener('newsroom:leave-confirmed', confirmed);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('newsroom:navigate', leave);
      window.removeEventListener('newsroom:leave-confirmed', confirmed);
    };
  }, [dirty, pending]);
  function update<K extends keyof PersonalAiInput>(field: K, value: PersonalAiInput[K]) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
    setResult('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy('save');
    setError('');
    setResult('');
    try {
      const value = await requestJson<PersonalAiSettings>('/api/settings/ai', 'PUT', {
        ...form,
        ...(key ? { apiKey: key } : {}),
      });
      setSaved(value);
      setForm(draft(value));
      setKey('');
      setConfirmDelete(false);
      setResult(
        value.effectiveMode === 'personal'
          ? '个人配置已保存。可以测试连接，后续 AI 任务将使用你的模型账号。'
          : value.mode === 'disabled'
            ? 'AI 已停用，原文阅读不受影响。'
            : value.siteAvailable
              ? '已切换为站点 AI 服务。'
              : '选择已保存，站点尚未启用 AI，仍可阅读原文。',
      );
      void onChanged().catch(() => {});
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function test() {
    if (!saved) return;
    setBusy('test');
    setError('');
    setResult('');
    try {
      const response = await requestJson<{ message: string }>('/api/settings/ai/test', 'POST', {
        revision: saved.revision,
      });
      setResult(response.message);
      void onChanged().catch(() => {});
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function remove() {
    if (!saved) return;
    setBusy('delete');
    setError('');
    setResult('');
    try {
      const value = await requestJson<PersonalAiSettings>('/api/settings/ai', 'DELETE', {
        revision: saved.revision,
      });
      setSaved(value);
      setForm(draft(value));
      setKey('');
      setConfirmDelete(false);
      setResult('个人密钥已删除，AI 已停用。不会自动切换到站点付费服务。');
      void onChanged().catch(() => {});
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="management-page settings-page personal-ai-page">
      <PersonalSettingsNav view="ai-settings" navigate={navigate} />
      <div className="management-heading">
        <div>
          <span className="eyebrow">AI, ON YOUR TERMS</span>
          <h1>个人 AI 服务</h1>
          <p>选择摘要和翻译的提供方式。AI 是可选项，随时可以继续阅读原文。</p>
        </div>
      </div>
      <section className="settings-card ai-settings-card" aria-busy={loading || pending}>
        <div className="settings-card-heading">
          <Sparkles size={20} />
          <h2>模型与费用归属</h2>
          {saved && (
            <span className="neutral-tag">
              {saved.effectiveMode === 'personal'
                ? '使用个人服务'
                : saved.effectiveMode === 'site'
                  ? '使用站点服务'
                  : '当前未启用'}
            </span>
          )}
        </div>
        {loading && (
          <p className="helper" role="status">
            <Loader2 size={16} className="spin" />
            正在加载个人配置…
          </p>
        )}
        {error && (
          <div className="personal-form-message error" role="alert">
            <p>{error}</p>
            <Button
              size="small"
              disabled={pending}
              onClick={() => {
                if (dirty && !window.confirm('重新加载会丢弃当前未保存的配置，是否继续？')) return;
                setLoading(true);
                setReload((n) => n + 1);
              }}
            >
              <RefreshCw size={14} />
              重新加载已保存配置
            </Button>
          </div>
        )}
        {result && (
          <p className="personal-form-message success" role="status">
            <Check size={17} />
            {result}
          </p>
        )}
        {saved && form && (
          <form onSubmit={(event) => void save(event)}>
            <fieldset disabled={pending || loading || demo} className="personal-ai-fields">
              <legend className="sr-only">个人 AI 配置</legend>
              <label className="ai-mode-label" htmlFor="personal-ai-mode">
                AI 提供方式
              </label>
              <select
                id="personal-ai-mode"
                className="select-input"
                value={form.mode}
                onChange={(event) => {
                  const mode = event.target.value as AiMode;
                  setForm({
                    ...form,
                    mode,
                    baseUrl: form.baseUrl || saved.allowedBaseUrls[0] || '',
                  });
                  setResult('');
                  setKey('');
                  setConfirmDelete(false);
                }}
              >
                <option value="site">使用站点提供的 AI</option>
                <option value="personal" disabled={!saved.personalAvailable}>
                  使用自己的模型密钥
                </option>
                <option value="disabled">停用 AI，仅阅读原文</option>
              </select>
              <p className="helper ai-mode-description">
                {form.mode === 'personal'
                  ? '请求会发送到你选择的模型服务，费用由该密钥对应的账号承担。保存配置后，新同步内容也可能自动生成摘要。'
                  : form.mode === 'site'
                    ? saved.siteAvailable
                      ? '由站点模型账号承担费用，受站点额度限制。'
                      : '站点暂未启用 AI。你仍可阅读原文，或在管理员开放后使用个人模型。'
                    : '不发起新的模型请求。历史结果和已发出的请求不会被撤回。'}
              </p>
              {form.mode === 'personal' && (
                <div className="personal-ai-grid">
                  <label className="wide-field">
                    服务地址
                    <select
                      className="select-input"
                      required
                      value={form.baseUrl}
                      onChange={(event) => {
                        update('baseUrl', event.target.value);
                        setKey('');
                      }}
                    >
                      <option value="" disabled>
                        选择管理员允许的服务地址
                      </option>
                      {saved.allowedBaseUrls.map((url) => (
                        <option key={url} value={url}>
                          {url}
                        </option>
                      ))}
                      {form.baseUrl && !saved.allowedBaseUrls.includes(form.baseUrl) && (
                        <option value={form.baseUrl} disabled>
                          {form.baseUrl}（已停用）
                        </option>
                      )}
                    </select>
                    <span className="helper">
                      使用兼容 Chat Completions 与 JSON Schema 输出的服务。地址由管理员审核后开放。
                    </span>
                  </label>
                  <label className="wide-field">
                    API Key{' '}
                    <span className="field-optional">
                      {saved.hasKey ? '已保存 · 留空保留' : '首次配置必填'}
                    </span>
                    <input
                      type="password"
                      name="personal-model-key"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={key}
                      maxLength={4096}
                      required={!saved.hasKey || form.baseUrl !== saved.baseUrl}
                      placeholder={
                        saved.hasKey
                          ? '已安全保存，不回显密钥；留空保留原密钥'
                          : '粘贴你自己的模型 API Key'
                      }
                      onChange={(event) => {
                        setKey(event.target.value);
                        setResult('');
                      }}
                    />
                    <span className="helper">
                      密钥仅用于你的模型请求，在服务器加密保存，不写入浏览器本地存储。
                    </span>
                  </label>
                  <label className="wide-field">
                    模型名称
                    <input
                      value={form.model}
                      maxLength={150}
                      required
                      placeholder="填写供应商提供的模型标识"
                      onChange={(event) => update('model', event.target.value)}
                    />
                  </label>
                  {(
                    [
                      ['inputPrice', '输入单价（美元 / 百万 Token）'],
                      ['outputPrice', '输出单价（美元 / 百万 Token）'],
                      ['dailyBudget', '每日预算（美元）'],
                      ['monthlyBudget', '每月预算（美元）'],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        type="number"
                        min="0.000001"
                        step="any"
                        max={field === 'dailyBudget' ? 1000 : 10000}
                        required
                        value={form[field]}
                        onChange={(event) => update(field, Number(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
              )}
              <p className="helper ai-budget-note">
                预算按 UTC 日 /
                月、填写的单价估算，并非供应商的硬额度。超时请求也可能计费，请同时在供应商账号中设置限额。
              </p>
              <div className="personal-ai-actions">
                <span className={dirty ? 'warning-text' : 'helper'} role="status">
                  {busy === 'save' ? '正在保存…' : dirty ? '有未保存修改' : '配置已同步'}
                </span>
                <Button
                  type="button"
                  onClick={() => void test()}
                  disabled={dirty || saved.effectiveMode !== 'personal'}
                  loading={busy === 'test'}
                >
                  {busy === 'test' ? <Loader2 className="spin" size={16} /> : <Wifi size={16} />}
                  测试已保存配置
                </Button>
                <Button type="submit" variant="primary" loading={busy === 'save'} disabled={!dirty}>
                  <Save size={16} />
                  保存配置
                </Button>
              </div>
            </fieldset>
            {demo && (
              <p className="personal-settings-note">
                <KeyRound size={16} />
                演示模式只展示设置，不接收真实密钥。请使用真实账号模式配置个人模型。
              </p>
            )}
            {!demo && !saved.personalAvailable && (
              <p className="personal-settings-note">
                管理员尚未开放个人服务地址，暂时不能添加个人密钥。站点服务和原文阅读仍可按当前状态使用。
              </p>
            )}
            {saved.hasKey && !demo && (
              <div className="personal-ai-delete">
                {confirmDelete ? (
                  <>
                    <p>删除后将停用 AI，不会自动切换到站点服务。已经发送的请求仍可能完成或计费。</p>
                    <div>
                      <Button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={pending}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        loading={busy === 'delete'}
                        disabled={pending}
                        onClick={() => void remove()}
                      >
                        确认删除密钥
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={16} />
                    删除个人密钥
                  </Button>
                )}
              </div>
            )}
          </form>
        )}
      </section>
      <p className="personal-settings-note">
        <ShieldCheck size={16} />
        个人配置只对当前账号生效；不会改变其他用户的模型、预算或平台授权。测试连接会发起一次小额模型请求。
      </p>
    </section>
  );
}
