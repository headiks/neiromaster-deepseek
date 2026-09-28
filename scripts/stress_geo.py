"""
Стресс-тест «вся Россия»: сотрудники из разных регионов с разной сетью и разных IP.

Запускает оркестратор scripts/stress_geo.sh — по контейнеру-генератору на регион. У каждого
региона своя сеть (задержка, разброс, потери — tc netem на интерфейсе контейнера; нет netem
в ядре — задержка эмулируется в коде), свои IP провайдеров (X-Forwarded-For: запросы идут
прямо в web, минуя Caddy, — приложение видит адрес сотрудника, лимиты на IP работают как в
жизни) и своя доля сотрудников. Каждый виртуальный сотрудник ведёт себя как приложение:

  - открыл приложение: входящие + расписание (часть — вход по паролю);
  - опрос входящих раз в ~30 с (как mobile/src/data.tsx), отметка «прочитано»;
  - вопрос ассистенту в среднем раз в 5 мин — из базы готовых ответов (DeepSeek не зовём);
  - в начале каждой ступени — рассылка сообщения плана всем сотрудникам региона (+пуш).

Ступени: число сотрудников растёт (--stages 500,1000,2000,3000 — на всю Россию), каждая
держится --stage-min минут. Итог — по ступеням, регионам и видам запросов.

    python scripts/stress_geo.py run --region msk ...   # запускает оркестратор
    python3 scripts/stress_geo.py report LOG...          # сводка (только stdlib)
"""
import argparse
import json
import random
import statistics
import sys
import threading
import time
import uuid

# доля сотрудников, задержка до сервера (мс), разброс (мс), потери (%), ограничение скорости,
# сети провайдеров (первые два октета) — адреса правдоподобные, не настоящих людей.
REGIONS = {
    "msk":    ("Москва и область",               0.30,  12,   4, 0.05, "",      [(95, 165), (178, 140), (46, 39), (5, 228)]),
    "spb":    ("Санкт-Петербург",                0.12,  18,   5, 0.05, "",      [(92, 100), (178, 70)]),
    "south":  ("Юг: Краснодар, Ростов",          0.10,  25,   8, 0.1,  "",      [(85, 113), (46, 61)]),
    "volga":  ("Поволжье: Казань, Самара",       0.13,  28,   8, 0.1,  "",      [(94, 180), (213, 87)]),
    "ural":   ("Урал: Екатеринбург, Челябинск",  0.13,  38,  10, 0.2,  "",      [(95, 190), (188, 19)]),
    "sib":    ("Сибирь: Новосибирск, Красноярск", 0.10,  60,  15, 0.3,  "",      [(46, 146), (95, 188)]),
    "fe":     ("Дальний Восток: Владивосток",    0.05, 110,  25, 0.5,  "",      [(95, 154), (212, 19)]),
    "mobile": ("Мобильный интернет, цеха",       0.07, 180,  80, 2.0,  "2mbit", [(176, 59), (37, 113)]),
}
POLL_S = 30
ASK_PER_MIN = 0.2
LOGIN_SHARE = 0.2


# ---------- Сводка (только stdlib: запускается на хосте) ----------
def report(paths):
    rows = []
    for p in paths:
        for line in open(p, encoding="utf-8", errors="replace"):
            if line.startswith("GEO_RESULT "):
                rows.append(json.loads(line[len("GEO_RESULT "):]))
    if not rows:
        print("нет результатов (GEO_RESULT) в логах")
        return
    netem = {r["region"]: r["netem"] for r in rows}
    print("Сеть по регионам: " + ", ".join(f"{k}={'netem' if v else 'эмуляция в коде'}" for k, v in netem.items()))
    stages = sorted({s["stage"] for r in rows for s in r["stages"]})
    for st in stages:
        per = [(r["region"], next(s for s in r["stages"] if s["stage"] == st)) for r in rows
               if any(s["stage"] == st for s in r["stages"])]
        users = sum(s["users"] for _, s in per)
        dur = max(s["seconds"] for _, s in per) or 1
        print(f"\n=== Ступень {st + 1}: {users} сотрудников по России, {dur:.0f} с")
        allreq = {}
        for _, s in per:
            for ep, lat in s["lat"].items():
                allreq.setdefault(ep, {"lat": [], "err": 0, "n": 0})
                allreq[ep]["lat"] += lat
                allreq[ep]["err"] += s["err"].get(ep, 0)
                allreq[ep]["n"] += len(lat) + s["err"].get(ep, 0)
        print(f"  {'запрос':14} {'всего':>7} {'в сек':>6} {'ошибок':>7} {'p50':>6} {'p95':>6} {'max':>6}")
        for ep, d in sorted(allreq.items()):
            lat = sorted(d["lat"]) or [0]
            print(f"  {ep:14} {d['n']:7} {d['n'] / dur:6.1f} {100 * d['err'] / max(d['n'], 1):6.1f}% "
                  f"{statistics.median(lat):6.2f} {lat[int(0.95 * (len(lat) - 1))]:6.2f} {lat[-1]:6.2f}")
        print(f"  {'регион':34} {'сотр.':>6} {'p95 входящие':>13} {'p95 вопрос':>11} {'ошибок':>7}  рассылка")
        for reg, s in per:
            p95 = lambda ep: (lambda l: f"{l[int(0.95 * (len(l) - 1))]:.2f}с" if l else "—")(sorted(s["lat"].get(ep, [])))  # noqa: E731
            n = sum(len(v) for v in s["lat"].values()) + sum(s["err"].values())
            push = s.get("push") or {}
            print(f"  {REGIONS[reg][0]:34} {s['users']:6} {p95('inbox'):>13} {p95('ask'):>11} "
                  f"{100 * sum(s['err'].values()) / max(n, 1):6.1f}%  {push.get('delivered', 0)} за {push.get('seconds', 0)}с")
        codes = {}
        for _, s in per:
            for k, v in s.get("codes", {}).items():
                codes[k] = codes.get(k, 0) + v
        if codes:
            print(f"  коды ошибок: {codes}")


# ---------- Генератор одного региона ----------
def run(a):
    import _path  # noqa: F401 — backend/ в sys.path
    import config  # noqa: F401
    import requests
    import auth
    import db
    import messaging
    import push
    import qacache
    import users
    from redis_conn import get_redis

    title, share, rtt, jitter, loss, rate, nets = REGIONS[a.region]
    prefix = f"stress-geo-{a.region}-"
    stages = [max(1, round(int(x) * share)) for x in a.stages.split(",")]
    total = stages[-1]
    r = get_redis()

    def cleanup():
        ids = [x["id"] for x in (db.query("SELECT id FROM users WHERE username LIKE %s", (prefix + "%",)) or [])]
        if ids:
            for table, col in (("sessions", "user_id"), ("scheduled_messages", "employee_id"),
                               ("push_tokens", "user_id"), ("questions", "user_id"), ("activity_log", "user_id")):
                db.execute(f"DELETE FROM {table} WHERE {col} = ANY(%s)", (ids,))
            db.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        return len(ids)

    cleanup()
    password = "Geo-" + uuid.uuid4().hex[:12]
    salt, digest = users.hash_password(password)
    vus = []
    now = time.time()
    for i in range(total):
        u = users.create_user({"username": f"{prefix}{i:04d}", "full_name": f"Гео {a.region} {i:04d}",
                               "position": "Стресс-тест"})
        tok = uuid.uuid4().hex + uuid.uuid4().hex
        db.execute("INSERT INTO sessions (token, user_id, created_at, seen_at) VALUES (%s,%s,%s,%s)",
                   (auth._hash_token(tok), u["id"], now, now))
        db.execute("INSERT INTO push_tokens (token, user_id, platform) VALUES (%s, %s, 'stress')",
                   (f"stress-geo-{u['id']}", u["id"]))
        for k in range(3):                             # во входящих уже есть что читать
            db.execute("INSERT INTO scheduled_messages (id, employee_id, message_id, title, body, send_at, "
                       "status, delivered_at) VALUES (%s,%s,%s,%s,%s,now(),'delivered',now())",
                       (str(uuid.uuid4()), u["id"], f"geo-{k}", "Сообщение плана", "Текст сообщения плана"))
        a1, b1 = random.choice(nets)
        vus.append({"id": u["id"], "username": u["username"], "token": tok,
                    "ip": f"{a1}.{b1}.{random.randint(0, 255)}.{random.randint(1, 254)}"})
    db.execute("UPDATE users SET salt = %s, hash = %s WHERE id = ANY(%s)", (salt, digest, [v["id"] for v in vus]))
    questions = [q["question"] for q in qacache.list_all(limit=3000) if q["source"] in ("faq", "section")][:500]
    print(f"[{a.region}] {title}: сотрудников {total}, вопросов из базы {len(questions)}", flush=True)
    if not questions:
        raise SystemExit("нет готовых ответов в базе — вопросы пошли бы в DeepSeek")

    r.sadd("nm:geo:ready", a.region)
    while not r.get("nm:geo:go"):
        time.sleep(1)
    netem = r.get(f"nm:geo:netem:{a.region}") == "ok"
    print(f"[{a.region}] старт; сеть: {'netem' if netem else f'эмуляция в коде {rtt}±{jitter} мс'}", flush=True)

    stage_idx = [0]
    stats = [{"lat": {}, "err": {}, "codes": {}} for _ in stages]
    lock = threading.Lock()
    stop = threading.Event()

    def net_delay():
        if not netem:
            time.sleep(max(0.0, random.gauss(rtt, jitter)) / 1000)

    def rec(ep, code, dt):
        with lock:
            st = stats[stage_idx[0]]
            if code == 200:
                st["lat"].setdefault(ep, []).append(round(dt, 3))
            else:
                st["err"][ep] = st["err"].get(ep, 0) + 1
                st["codes"][str(code)] = st["codes"].get(str(code), 0) + 1

    def vu(v):
        s = requests.Session()
        s.headers.update({"X-Forwarded-For": v["ip"]})
        token = v["token"]

        # Время ответа — как видит сотрудник: сеть до сервера + обработка. netem задерживает
        # исходящие пакеты контейнера; без него та же задержка — сном перед запросом.
        def call(ep, method, path, **kw):
            t = time.perf_counter()
            net_delay()
            try:
                resp = s.request(method, a.target + path, timeout=120,
                                 headers={"Authorization": f"Bearer {token}"}, **kw)
                code = resp.status_code
            except Exception as e:
                resp, code = None, type(e).__name__
            rec(ep, code, time.perf_counter() - t)
            return resp

        time.sleep(random.uniform(0, 20))                 # не все открывают в одну секунду
        if random.random() < LOGIN_SHARE:
            t = time.perf_counter()
            net_delay()
            try:
                resp = s.post(a.target + "/api/login", timeout=60,
                              json={"username": v["username"], "password": password})
                code = resp.status_code
                if code == 200:
                    token = resp.json().get("token") or token
            except Exception as e:
                code = type(e).__name__
            rec("login", code, time.perf_counter() - t)
        call("inbox", "GET", "/api/my/messages")
        call("schedule", "GET", "/api/my/schedule")
        next_poll = time.time() + random.uniform(POLL_S - 5, POLL_S + 5)
        next_ask = time.time() + random.expovariate(ASK_PER_MIN / 60)
        while not stop.is_set():
            wait = min(next_poll, next_ask) - time.time()
            if wait > 0 and stop.wait(wait):
                break
            if time.time() >= next_poll:
                resp = call("inbox", "GET", "/api/my/messages")
                next_poll = time.time() + random.uniform(POLL_S - 3, POLL_S + 3)
                try:
                    unread = [m for m in (resp.json().get("messages") or []) if not m.get("read_at")] if resp is not None and resp.status_code == 200 else []
                except Exception:
                    unread = []
                if unread and random.random() < 0.3:
                    call("read", "POST", f"/api/my/messages/{unread[0]['id']}/read", json={})
            if time.time() >= next_ask:
                call("ask", "POST", "/ask", json={"question": random.choice(questions)})
                next_ask = time.time() + random.expovariate(ASK_PER_MIN / 60)

    threads, started = [], 0
    for i, target in enumerate(stages):
        stage_idx[0] = i
        t0 = time.time()
        while started < target:
            th = threading.Thread(target=vu, args=(vus[started],), daemon=True)
            th.start()
            threads.append(th)
            started += 1
        # Рассылка ступени: всем сотрудникам региона наступает сообщение плана (+пуш в FCM на
        # фиктивные токены) — как ежедневная рассылка в 9:00.
        ids = [v["id"] for v in vus[:started]]
        for uid in ids:
            db.execute("INSERT INTO scheduled_messages (id, employee_id, message_id, title, body, send_at, status) "
                       "VALUES (%s,%s,%s,%s,%s,now() - interval '1 second','pending')",
                       (str(uuid.uuid4()), uid, f"geo-stage{i}", "Новое сообщение", "Сообщение ступени"))
        tp = time.perf_counter()
        rows = db.query("UPDATE scheduled_messages SET status = 'delivered', delivered_at = now(), updated_at = now() "
                        "WHERE status = 'pending' AND employee_id = ANY(%s) RETURNING id, employee_id, title, body, kind",
                        (ids,)) or []
        push.notify(messaging.group_pushes(rows))
        stats[i]["push"] = {"delivered": len(rows), "seconds": round(time.perf_counter() - tp, 1)}
        stats[i]["users"] = started
        time.sleep(max(0.0, a.stage_min * 60 - (time.time() - t0)))
        stats[i]["seconds"] = round(time.time() - t0, 1)
        print(f"[{a.region}] ступень {i + 1}: сотрудников {started}, "
              f"запросов {sum(len(x) for x in stats[i]['lat'].values())}, ошибок {sum(stats[i]['err'].values())}",
              flush=True)
    stop.set()
    for th in threads:
        th.join(5)
    out = {"region": a.region, "netem": netem, "stages": [{"stage": i, **s} for i, s in enumerate(stats)]}
    print("GEO_RESULT " + json.dumps(out, ensure_ascii=False), flush=True)
    print(f"[{a.region}] удалено тестовых сотрудников: {cleanup()}", flush=True)


def main():
    ap = argparse.ArgumentParser(description="Стресс-тест «вся Россия»")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run")
    p.add_argument("--region", choices=sorted(REGIONS), required=True)
    p.add_argument("--stages", default="500,1000,2000,3000", help="сотрудников на всю Россию по ступеням")
    p.add_argument("--stage-min", type=float, default=3)
    p.add_argument("--target", default="http://neiromaster-web-1:8000")
    sub.add_parser("regions")
    p = sub.add_parser("report")
    p.add_argument("logs", nargs="+")
    a = ap.parse_args()
    if a.cmd == "run":
        run(a)
    elif a.cmd == "regions":
        for k, (title, share, rtt, jitter, loss, rate, _) in REGIONS.items():
            print(f"{k} {rtt} {jitter} {loss} {rate or '-'}")
    else:
        report(a.logs)


if __name__ == "__main__":
    sys.exit(main())
