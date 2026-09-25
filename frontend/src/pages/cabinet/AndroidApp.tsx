// Приложение для Android: скачать APK и установить. Страница открыта и без входа — сотрудник
// может скачать приложение прямо на телефон, а войти уже в приложении.
import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { ruDate } from '@shared/format';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import { InboxProvider } from '../../lib/inbox';
import { AppShell } from '../../blocks/AppShell';
import { Callout, Card, Logo, PageHeader, Spinner } from '../../ui';

type Info = { available: boolean; url?: string; size?: number; updated_at?: string };

const isAndroid = /android/i.test(navigator.userAgent);
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

function Content() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    document.title = 'Приложение для Android · НейроМастер';
    api.get<Info>('/api/app/android').then(setInfo).catch(() => setInfo({ available: false }));
  }, []);
  const link = `${location.origin}/app`;
  return (
    <div className="nm-page" style={{ maxWidth: 720 }}>
      <PageHeader title="Приложение для Android"
                  subtitle="Сообщения плана адаптации приходят уведомлением на телефон, вопрос ассистенту — в пару касаний." />
      <Card className="nm-stack" style={{ gap: 16 }}>
        <div className="nm-row" style={{ gap: 14, alignItems: 'center' }}>
          <Logo size={48} />
          <div className="nm-grow">
            <div style={{ fontWeight: 700, fontSize: 18 }}>НейроМастер</div>
            <div className="nm-small nm-muted">
              {info?.available ? `Android · ${((info.size || 0) / 1048576).toFixed(0)} МБ · от ${ruDate(info.updated_at)}` : 'Android'}
            </div>
          </div>
        </div>
        {!info ? <Spinner /> : info.available ? (
          <a className="nm-btn nm-btn-primary nm-btn-lg nm-btn-block" href={info.url} download="NeiroMaster.apk">
            <Download aria-hidden />Скачать приложение
          </a>
        ) : (
          <Callout tone="warn">Приложение пока не загружено на сервер — обратитесь к администратору.</Callout>
        )}
        {isIOS && <Callout>Для iPhone приложения пока нет — пользуйтесь сайтом, в нём всё то же самое.</Callout>}
        {!isAndroid && !isIOS && (
          <Callout icon={Smartphone}>Откройте на телефоне адрес <b>{link}</b> и скачайте приложение там.</Callout>
        )}
      </Card>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Как установить</div>
        <ol className="nm-body" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
          <li>Нажмите «Скачать приложение» и дождитесь загрузки файла.</li>
          <li>Откройте скачанный файл NeiroMaster.apk. Если телефон спросит — разрешите установку приложений из этого источника (браузера или «Файлов»).</li>
          <li>Нажмите «Установить», затем «Открыть».</li>
          <li>Войдите тем же логином и паролем, что на сайте, и разрешите уведомления.</li>
        </ol>
        <p className="nm-small nm-muted" style={{ margin: '10px 0 0' }}>
          Новая версия ставится поверх старой — удалять приложение не нужно, вход сохранится.
        </p>
      </Card>
    </div>
  );
}

export default function AndroidApp() {
  const { me, loading } = useMe();
  if (loading) return <div className="nm-auth"><Spinner /></div>;
  return me && !me.must_change_credentials ? <InboxProvider enabled><AppShell><Content /></AppShell></InboxProvider> : <main className="nm-main"><Content /></main>;
}
