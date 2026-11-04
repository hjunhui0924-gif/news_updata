'use client';
export default function ServiceError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="empty-state" role="alert">
      <h1>暂时无法打开工作空间</h1>
      <p>请确认 PostgreSQL 已启动且数据库迁移完成，然后重试。</p>
      <button className="button" onClick={retry}>
        重新加载工作空间
      </button>
      <p>后台任务离线时仍可阅读已有更新；同步和摘要会等待 Worker 恢复。</p>
    </main>
  );
}
