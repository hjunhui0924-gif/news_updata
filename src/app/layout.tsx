import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '知更 · 开发者更新助手',
  description: '关注值得关注的人与项目，用中文读懂每一次更新。',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
