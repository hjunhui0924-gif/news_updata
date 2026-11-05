import { Plug, Settings2, Sparkles } from 'lucide-react';
export function PersonalSettingsNav({
  view,
  navigate,
}: {
  view: string;
  navigate: (view: string) => void;
}) {
  return (
    <nav className="personal-settings-nav" aria-label="个人设置导航">
      {[
        { id: 'settings', title: '阅读偏好', icon: Settings2 },
        { id: 'connections', title: '账号与连接', icon: Plug },
        { id: 'ai-settings', title: '个人 AI 服务', icon: Sparkles },
      ].map(({ id, title, icon: Icon }) => (
        <button
          key={id}
          aria-current={view === id ? 'page' : undefined}
          onClick={() => navigate(id)}
        >
          <Icon size={16} />
          {title}
        </button>
      ))}
    </nav>
  );
}
