import { Lock, RefreshCw } from "lucide-react";
type Props = {
  trusted: boolean;
  filtered?: boolean;
  busy: boolean;
  onPermission: () => void;
  onRefresh: () => void;
};
export default function WindowAccessState({
  trusted,
  filtered,
  busy,
  onPermission,
  onRefresh,
}: Props) {
  if (filtered && trusted)
    return <p className="empty">一致するウィンドウがありません。</p>;
  return (
    <div className="window-access-state" role="status">
      {!trusted && <Lock size={20} />}
      <b>
        {trusted
          ? "操作できるウィンドウがありません"
          : "ウィンドウの取得に許可が必要です"}
      </b>
      <p>
        {trusted
          ? "通常のアプリのウィンドウを開いて再取得してください。最小化中・別Space・特殊ウィンドウは対象外です。"
          : "システム設定 → プライバシーとセキュリティ → アクセシビリティで、WindowHubをオンにしてください。"}
      </p>
      {!trusted && (
        <p className="access-detail">
          追加するアプリは「アプリケーション」のWindowHubです。許可後にハブを開き直すか、「許可を確認」を押してください。
        </p>
      )}
      <div>
        {!trusted && (
          <button className="primary" disabled={busy} onClick={onPermission}>
            設定を開く
          </button>
        )}
        <button disabled={busy} onClick={onRefresh}>
          <RefreshCw size={12} />
          {trusted ? "再取得" : "許可を確認"}
        </button>
      </div>
    </div>
  );
}
