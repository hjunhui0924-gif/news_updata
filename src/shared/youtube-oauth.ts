export type YouTubeOAuthStage = 'state' | 'token' | 'scope' | 'identity' | 'channel' | 'storage';
export type YouTubeOAuthRecovery =
  'session' | 'state' | 'permission' | 'reconnect' | 'configuration' | 'temporary';
export const youtubeOAuthMessages: Record<YouTubeOAuthRecovery, string> = {
  session: '网站登录已失效，请先登录本站，再连接 YouTube。',
  state: 'YouTube 授权请求已过期或不匹配，请从本站重新连接。',
  permission: '未取得读取 YouTube 关注的权限，请重新连接并同意只读授权。',
  reconnect: 'Google 未接受本次授权，请从本站重新连接。',
  configuration: 'YouTube 连接配置不可用，请检查服务端配置后重试。',
  temporary: 'YouTube 暂时无法完成连接，请稍后重试；已有内容仍可阅读。',
};
export function youtubeOAuthMessage(reason: string | null) {
  return reason && Object.prototype.hasOwnProperty.call(youtubeOAuthMessages, reason)
    ? youtubeOAuthMessages[reason as YouTubeOAuthRecovery]
    : 'YouTube 授权未完成，请重新连接';
}
