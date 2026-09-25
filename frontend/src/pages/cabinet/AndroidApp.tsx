// Приложение для Android: скачать APK и установить. Страница открыта и без входа — сотрудник
// может скачать приложение прямо на телефон, а войти уже в приложении.
import { useEffect, useMemo, useState } from 'react';
import { Download, QrCode } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { ruDate } from '@shared/format';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import { InboxProvider } from '../../lib/inbox';
import { AppShell } from '../../blocks/AppShell';
import { Button, Callout, Card, Logo, PageHeader, Spinner } from '../../ui';

type Info = { available: boolean; url?: string; size?: number; updated_at?: string; failed?: boolean };

const isAndroid = /android/i.test(navigator.userAgent);
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

/** QR-код ссылки: тёмные модули на белом в любой теме (иначе камеры не читают), поле 4 модуля. */
function Qr({ text, size = 200 }: { text: string; size?: number }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n: n + 8, d };
  }, [text]);
  return (
    <svg className="nm-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges"
         role="img" aria-label={`QR-код: ${text}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Сохранить QR картинкой — распечатать на стенд или вставить в письмо новичкам. */
function saveQr() {
  const svg = document.querySelector('svg.nm-qr');
  if (!svg) return;
  const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'NeiroMaster-QR.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Content() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    document.title = 'Приложение для Android · НейроМастер';
    api.get<Info>('/api/app/android').then(setInfo).catch(() => setInfo({ available: false, failed: true }));
  }, []);
  const page = `${location.origin}/app`;
  const apk = `${location.origin}/app/android.apk`;
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
        ) : info.failed ? (
          <Callout tone="danger" action={<Button size="sm" onClick={() => location.reload()}>Повторить</Button>}>Не удалось связаться с сервером.</Callout>
        ) : (
          <Callout tone="warn">Приложение пока не загружено на сервер — обратитесь к администратору.</Callout>
        )}
        {isIOS && <Callout>Для iPhone приложения пока нет — пользуйтесь сайтом, в нём всё то же самое.</Callout>}
      </Card>
      {info?.available && !isAndroid && (
        <Card className="nm-qr-card">
          <Qr text={apk} />
          <div className="nm-stack" style={{ gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Скачать на телефон по QR-коду</div>
            <p className="nm-body" style={{ margin: 0 }}>
              Наведите камеру Android-телефона на код и откройте ссылку — скачивание начнётся сразу.
              Или наберите в браузере телефона адрес <b>{page}</b>.
            </p>
            <div><Button size="sm" icon={QrCode} onClick={saveQr}>Сохранить QR-код</Button></div>
          </div>
        </Card>
      )}
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
        <Callout tone="warn">
          Ставили приложение до 25 сентября 2026? Один раз удалите старую версию и установите заново:
          теперь приложение подписано ключом НейроМастера, и Android не обновит его поверх прежней сборки.
        </Callout>
      </Card>
    </div>
  );
}

export default function AndroidApp() {
  const { me, loading } = useMe();
  if (loading) return <div className="nm-auth"><Spinner /></div>;
  return me && !me.must_change_credentials ? <InboxProvider enabled><AppShell><Content /></AppShell></InboxProvider> : <main className="nm-main"><Content /></main>;
}
