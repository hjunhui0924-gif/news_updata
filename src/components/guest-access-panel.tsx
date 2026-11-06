import { ArrowRight, LockKeyhole } from 'lucide-react';

export function GuestAccessPanel({ title, description }: { title: string; description: string }) {
  return (
    <section className="management-page guest-access-page" aria-labelledby="guest-access-title">
      <div className="guest-access-card">
        <span className="guest-access-icon" aria-hidden="true">
          <LockKeyhole size={22} />
        </span>
        <span className="eyebrow">LOGIN TO CONTINUE</span>
        <h1 id="guest-access-title">{title}</h1>
        <p>{description}</p>
        <a className="button primary" href="/login">
          使用 GitHub 登录
          <ArrowRight size={16} />
        </a>
      </div>
    </section>
  );
}
