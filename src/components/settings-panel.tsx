'use client';
import { useState } from 'react';
import {
  Check,
  FileText,
  CodeXml as Github,
  Globe2,
  LayoutList,
  Loader2,
  Radio,
  Save,
  Sparkles,
} from 'lucide-react';
import type { Bootstrap, Preferences } from '@/shared/types';
import { Button } from './ui/button';
import { Markdown } from './markdown';
export function SettingsPanel({
  data,
  busy,
  save,
  preview,
}: {
  data: Bootstrap;
  busy: string;
  save: (v: Preferences) => Promise<void>;
  preview: () => Promise<void>;
  notify: (m: string) => void;
}) {
  const [preferences, setPreferences] = useState(data.preferences);
  const workerOnline = data.services.workerOnline;
  return (
    <section className="management-page settings-page">
      <div className="management-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>按你的节奏阅读</h1>
          <p>让内容更合心意，把注意力留给重要的变化。</p>
        </div>
      </div>
      <section className="settings-card">
        <div className="settings-card-heading">
          <LayoutList size={19} />
          <h2>阅读偏好</h2>
        </div>
        <div className="setting-row">
          <div>
            <strong>紧凑列表</strong>
            <p>减少条目间距，在一屏中看到更多更新。</p>
          </div>
          <button
            className={`switch ${preferences.compact ? 'on' : ''}`}
            role="switch"
            aria-checked={preferences.compact}
            aria-label="紧凑列表"
            onClick={() => setPreferences({ ...preferences, compact: !preferences.compact })}
          >
            <span />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>显示时区</strong>
            <p>用于详情页的日期和时间显示。</p>
          </div>
          <select
            aria-label="显示时区"
            className="select-input"
            value={preferences.timezone}
            onChange={(e) => setPreferences({ ...preferences, timezone: e.target.value })}
          >
            <option value="Asia/Shanghai">中国标准时间</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">纽约</option>
            <option value="Europe/London">伦敦</option>
          </select>
        </div>
        <div className="settings-save">
          <Button
            variant="primary"
            size="small"
            onClick={() => save(preferences)}
            disabled={busy === 'settings'}
          >
            {busy === 'settings' ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            保存偏好
          </Button>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading">
          <Radio size={19} />
          <h2>内容与服务</h2>
        </div>
        <div className="service-grid">
          <div>
            <Github size={21} />
            <strong>GitHub</strong>
            <span>{data.services.github ? '已配置访问凭据' : '公开访问 · 未配置 Token'}</span>
          </div>
          <div>
            <Sparkles size={21} />
            <strong>AI 总结与翻译</strong>
            <span>
              {data.services.ai
                ? '服务已开启'
                : data.mode === 'demo'
                  ? '演示样本可体验'
                  : '待配置模型服务'}
            </span>
          </div>
          <div>
            <Globe2 size={21} />
            <strong>后台同步</strong>
            <span className={workerOnline ? 'success-text' : 'warning-text'}>
              {workerOnline ? '正在运行' : '等待后台任务启动'}
            </span>
          </div>
        </div>
        <p className="service-note">
          真实 AI 调用的今日估算费用：${data.services.costToday.toFixed(4)}
          。模型未配置时，原文阅读不受影响。
        </p>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading">
          <FileText size={19} />
          <h2>一页看懂近期更新</h2>
          <span className="neutral-tag">仅网页展示</span>
        </div>
        <p className="helper">将近期未读更新整理成一份站内简报，不发送邮件。优先展示重点项目。</p>
        <Button size="small" onClick={preview} disabled={busy === 'digest'}>
          {busy === 'digest' ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
          生成更新简报
        </Button>
        {data.notifications[0] && (
          <div className="digest-preview">
            <span className="success-text">
              <Check size={14} />
              已生成 ·{' '}
              {new Date(data.notifications[0].createdAt).toLocaleString('zh-CN', {
                timeZone: preferences.timezone,
              })}
            </span>
            <Markdown text={data.notifications[0].body} />
          </div>
        )}
      </section>
      {data.mode === 'demo' && (
        <p className="demo-explanation">
          演示更新与译文是预先编写的样本，不代表项目的真实发布记录。添加真实订阅后，新的内容会标注为
          GitHub 公开数据。
        </p>
      )}
    </section>
  );
}
